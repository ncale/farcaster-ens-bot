import cron from "node-cron";
import neynarClient from "./neynarClient";
import duneClient from "./duneClient";
import { QueryParameter } from "@cowprotocol/ts-dune-client";
import {
  PUBLISH_CAST_TIME,
  SIGNER_UUID,
  TIME_ZONE,
  NEYNAR_API_KEY,
  DUNE_API_KEY,
  FARCASTER_BOT_MNEMONIC,
} from "./config";
import {
  User,
  UsernameHistory
} from "./appTypes"
import { isApiErrorResponse } from "@neynar/nodejs-sdk";


// Assign Dune query IDs
const CURRENT_LEADERBOARD_QUERY_ID = 3383049;
const USERNAME_LOOKUP_QUERY_ID = 3386538;


// Validating necessary environment variables or configurations.
if (!FARCASTER_BOT_MNEMONIC) {
  throw new Error("FARCASTER_BOT_MNEMONIC is not defined");
}
if (!SIGNER_UUID) {
  throw new Error("SIGNER_UUID is not defined");
}
if (!NEYNAR_API_KEY) {
  throw new Error("NEYNAR_API_KEY is not defined");
}
if (!DUNE_API_KEY) {
  throw new Error("DUNE_API_KEY is not defined");
}


/**
 * Function to return the results of a dune query
 * @param queryID - The published dune query ID to be called
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
 * @param msg - The message to be published.
 * @param replyHash - The hash of the parent cast if this is a reply
 */
const publishCast = async (msg: string, replyHash: string = "") => {
  try {
    // Using the neynarClient to publish the cast.
    if (replyHash) {
      let response = await neynarClient.publishCast(SIGNER_UUID, msg, {replyTo: replyHash});
      console.log("Published Cast:", response);
    } else {
      let response = await neynarClient.publishCast(SIGNER_UUID, msg);
      console.log("Published Cast:", response);
    };
    console.log("Cast published successfully");
  } catch (err) {
    // Error handling, checking if it's an API response error.
    if (isApiErrorResponse(err)) {
      console.log(err.response.data);
    } else console.log(err);
  }
};


/**
 * Function to create and return a list of messages. The number of messages depends on how many users change their username, so as not to exceed the Farcaster char limit.
 * @param userList - The array of usernames. Each item is an object containing prevUsername and newUsername
 * @returns 
 */
const createMessages = (userList: UsernameHistory[]): string[] => {
  // Initialize messages array
  let messages: string[] = [];
  // Function to create the first line of text
  const createFirstLineText = (numUsers: number): string => {return `${numUsers} new user${numUsers > 1 ? "s have" : " has"} joined the .eth family!\n`} // 40-43 chars; 35 plain text, 4-6 changing language, 1-2 num chars
  // Write first line
  messages.push(createFirstLineText(userList.length));
  // Function to create the text for each username change
  const createUsernameChangeText = (prevU: string, newU: string): string => {return `@${prevU} changed to ${newU}\n`}; // 15 chars w/out usernames
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





const getCurrentLeaderboard = async (): Promise<Record<string, unknown>[] | undefined> => {
  let rows = await queryDune(CURRENT_LEADERBOARD_QUERY_ID);
  return rows;
}

let leaderboardData = getCurrentLeaderboard();
let loopNum = 1;

const runBot = async () => {
  // If first time running, return tomorrow
  if (loopNum == 1) {
    loopNum += 1;
    return;
  }

  // Create a string of FIDs in a list format (ex. '(x, y, z)') to be passed to dune as a parameter
  let fidList = "(";
  leaderboardData.forEach((user: User): void => {
    fidList += `${user.fid}, `;
  });
  fidList += ")";

  // Put parameter into cowprotocol dune client format
  const parameters = [
    QueryParameter.text("fid_list_parameter", fidList)
  ];

  // Using that parameter, query the current usernames
  let updatedUsernames: Record<string, unknown>[] | undefined = await queryDune(USERNAME_LOOKUP_QUERY_ID, parameters);

  // Check which usernames are different ... this code will not work if Dune / postgres rearranges the returned query order
  let differingUsernames: UsernameHistory[];
  leaderboardData.forEach((user: User, i: number): void => {
    // Check if the username is the same. If not, save to var
    if (user.username != updatedUsernames[i].username) {
      differingUsernames.push({prevUsername: user.username, newUsername: updatedUsernames[i].username})
    }
  });

  // Create and cast messages
  if (differingUsernames.length > 0) {
    // Create a list of messages containing the usernames - 320 total characters per cast
    const messages = createMessages(differingUsernames);
    // Cast the messages
    let response = await publishCast(messages[0])
          // <- need to get the hash of the original cast so it can reply here if needed
    if (messages.length > 1) {
      messages.forEach((message: string): void => {
        let response = await publishCast(message) // this function needs to reply to the one previous
      });
    }
  }
};

const cronFunc = async () => {
  // Await to ensure yesterday's leaderboard values are used
  await runBot();
  // Overwrite yesterday's leaderboard values. Retrieve the current leaderboard for tomorrow.
  leaderboardData = getCurrentLeaderboard();
  loopNum += 1;
}

// Initial cast
publishCast(
  `gm! I bring updates of farcaster users' usage of fully decentralized domains (via ens!). Look 
  forward to updates of popular farcaster accounts that switch their original fnames to a .eth name!`
);

// Extracting hour and minute from the PUBLISH_CAST_TIME configuration.
const [hour, minute] = PUBLISH_CAST_TIME.split(":");

// Scheduling a cron job to publish a message at a specific time every day.
cron.schedule(
  `${minute} ${hour} * * *`, // Cron time format
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
