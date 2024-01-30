import cron from "node-cron";
import neynarClient from "./clients/neynarClient";
import duneClient from "./clients/duneClient";
import { QueryParameter } from "@cowprotocol/ts-dune-client";
import {
  PUBLISH_CAST_TIME,
  SIGNER_UUID,
  TIME_ZONE,
  FARCASTER_BOT_MNEMONIC,
} from "./config";
import {
  UsernameHistory
} from "./types"
import { isApiErrorResponse } from "@neynar/nodejs-sdk";
import { PostCastResponseCast } from "@neynar/nodejs-sdk/build/neynar-api/neynar-v2-api";

// Validating necessary environment variables or configurations.
if (!FARCASTER_BOT_MNEMONIC) {
    throw new Error("FARCASTER_BOT_MNEMONIC is not defined");
}
if (!SIGNER_UUID) {
    throw new Error("SIGNER_UUID is not defined");
}

// Assign Dune query IDs
const CURRENT_LEADERBOARD_QUERY_ID = 3380826;
const USERNAME_LOOKUP_QUERY_ID = 3386538;

/**
 * Function to return the results of a given dune query
 * 
 * @param {number} queryID - The published dune query ID to be called
 * @param {QueryParameter[]} parameters - An array of parameters to be passed to the function if applicable
 * @returns {Record<string, unknown>[] | undefined} A promise that resolves to an array of 
 * objects containing fid, username, and optionally total_followers
 */
const queryDune = async (queryID: number, parameters: QueryParameter[] = []): Promise<Record<string, unknown>[] | undefined> => {
  try {
    if (parameters) {
      let response = await duneClient.refresh(queryID, parameters);
      return response.result?.rows;
    } else {
      let response = await duneClient.refresh(queryID);
      return response.result?.rows;
    };
  } catch (err) {
    console.log(err);
  }
};

/**
 * Function to publish a message (cast) using neynarClient.
 * 
 * @param {string} msg - The message to be published.
 * @param {string} replyHash - The hash of the parent cast if this is a reply
 */
const publishCast = async (msg: string, replyHash: string = ""): Promise<PostCastResponseCast | undefined> => {
  try {
    // Using the neynarClient to publish the cast.
    if (replyHash) {
      let response: PostCastResponseCast = await neynarClient.publishCast(SIGNER_UUID, msg, {replyTo: replyHash});
      console.log("Published Cast:", response);
      return response;
    } else {
      let response: PostCastResponseCast = await neynarClient.publishCast(SIGNER_UUID, msg);
      console.log("Published Cast:", response);
      return response;
    };
  } catch (err) {
    // Error handling, checking if it's an API response error.
    if (isApiErrorResponse(err)) {
      console.log(err.response.data);
    } else console.log(err);
  }
};

/**
 * Async function to cast the array of messages. Each message should reply to the previous.
 * 
 * @param {string[]} messages - array of the messages to be cast
 * @returns <<<<<-------NEEDS TO RETURN SOMETHING OR CODE LATER NEEDS TO BE CHANGED
 */
const castDailyMessages = async (messages: string[]) => {
  // Cast the first message
  let response = await publishCast(messages[0])
  console.log("Main cast published successfully\n", response)
  // If more than one message, cast the rest as replies
  if (messages.length > 1) {
    // Save the hash value of the first message
    let hashes: string[] = [response!.hash];
    // Remove the first message
    messages.shift();
    // Iterate through
    for (const i in messages) {
      // Cast as reply to previous hash
      let response = await publishCast(messages[i], hashes[i])
      hashes.push(response!.hash);
    };
  };
};

/**
 * Function to create and return a list of messages. The number of messages depends 
 * on how many users change their username, so as not to exceed the Farcaster char limit.
 * 
 * @param {UsernameHistory[]} userList - The array of objects containing previous and new usernames
 * @returns {string[]} An array of strings to be cast, each one as a reply to the previous
 */
const createMessages = (userList: UsernameHistory[]): string[] => {
  // Initialize messages array
  let messages: string[] = [];
  // Function to create the first line of text
  const createFirstLineText = (numUsers: number): string => {return `${numUsers} new user${numUsers > 1 ? "s have" : " has"} joined the .eth family!\n`} // 40-43 chars; 35 plain text, 4-6 changing language, 1-2 num chars
  // Write first line
  messages.push(createFirstLineText(userList.length));
  // Function to create the text for each username change
  const createUsernameChangeText = (prevU: string | unknown, newU: string | unknown): string => {return `@${prevU} changed to ${newU}\n`}; // 15 chars w/out usernames
  // Write a line for each user in the list
  userList.forEach((usernames: UsernameHistory): void => {
    // If the line makes the message char count greater than 320 (Farcaster's limit), then it will push to a new cast
    let lineText: string = createUsernameChangeText(usernames.prevUsername, usernames.newUsername)
    if ((messages[messages.length-1].length + lineText.length) < 320) {
      messages[messages.length-1] += lineText;
    } else {
      messages.push(lineText);
    };
  });
  return messages;
};

/**
 * Function to retrieve to current 150 most followed Farcaster accounts
 * 
 * @returns {Record<string, unknown>[] | undefined} A promise that resolves to an 
 * array of objects containing fid, username, and optionally total_followers
 */
const getCurrentLeaderboard = async (): Promise<Record<string, unknown>[] | undefined> => {
  let rows = await queryDune(CURRENT_LEADERBOARD_QUERY_ID);
  return rows;
}

/**
 * Function to create a string formatted as a list to be passed to the Dune api as a query parameter
 * 
 * @returns {string} a list of Farcaster IDs to be passed to Dune as a parameter
 * @example passing an array of [10, 11, 12] will return '(10, 11, 12)'
 */
const createFidListString = (): string => {
  let fidList = "(";
  leaderboardData!.forEach((user: Record<string, unknown>): void => {
    fidList += `${user.fid}, `;
  });
  fidList += ")";
  return fidList;
}

/**
 * Function to check the original data against the new query to validate which Farcaster usernames have 
 * changed in the past day.
 * 
 * @param {Record<string, unknown>[] | undefined} updatedUsernames - array of objects containing fid and username
 * @returns {UsernameHistory[]} array of objects containing a previous username and a new username
 */
const checkDifferingUsernames = (updatedUsernames: Record<string, unknown>[] | undefined):UsernameHistory[] => {
  let differingUsernames: UsernameHistory[] = [];
  leaderboardData!.forEach((user: Record<string, unknown>, i: number): void => {
    // Check if the username is the same. If different, save to var
    let prevUsername = user.username;
    let newUsername = updatedUsernames![i].username;
    if (prevUsername != newUsername) {
      differingUsernames.push({"prevUsername": prevUsername, "newUsername": newUsername})
    };
  });
  return differingUsernames;
};

/**
 * Async function of the bot's primary behavior. Uses the global leaderboardData variable to query 
 * current usernames, check the names that are different, and cast the differences
 * 
 */
const runBot = async () => {
  try {
    // Query the top leaderboard's current usernames
    const fidList: string = createFidListString();
    const parameters = [
      QueryParameter.text("fid_list_parameter", fidList)
    ];
    let updatedUsernames: Record<string, unknown>[] | undefined = await queryDune(USERNAME_LOOKUP_QUERY_ID, parameters);

    // Check which usernames are different
    let differingUsernames = checkDifferingUsernames(updatedUsernames)

    // Create and cast messages
    if (differingUsernames.length > 0) {
      // Create a list of messages containing the usernames - 320 total characters per cast
      const messages = createMessages(differingUsernames);
      await castDailyMessages(messages);
    };
  } catch (err) {
    console.log(err);
  };
};

/**
 * Async function to be run daily by the cron job. Runs the bot if it has leaderboardData available
 * to check.
 * 
 */
const cronFunc = async () => {
  if (leaderboardData) {
    await runBot();
  } else {
    // Initial cast
    await publishCast(
      `gm! I bring updates of farcaster users' usage of fully decentralized domains (via ens!). Look 
      forward to updates of popular farcaster accounts that switch their original fnames to a .eth name!`
    );
  };
  // Overwrite the previous day's leaderboard values. Retrieve the current leaderboard for tomorrow.
  leaderboardData = await getCurrentLeaderboard();
}





// Extracting hour and minute from the PUBLISH_CAST_TIME configuration.
const [hour, minute] = PUBLISH_CAST_TIME.split(":");

// Initialize Dune leaderboard data
let leaderboardData: Record<string, unknown>[] | undefined;

// Schedule cron job
cron.schedule(
  `${minute} ${hour} * * *`,
  cronFunc,
  {
    scheduled: true, // Ensure the job is scheduled.
    timezone: TIME_ZONE, // Set the timezone for the schedule.
  }
);

// Logging to inform that the cron job is scheduled.
console.log(
  `Cron job scheduled at ${PUBLISH_CAST_TIME} ${TIME_ZONE}, please don't restart your system before the scheduled time.`
);
