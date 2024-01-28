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
import { isApiErrorResponse } from "@neynar/nodejs-sdk";

// Assign Dune query ID
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
 * Function to publish a message (cast) using neynarClient.
 * @param msg - The message to be published.
 */
const publishCast = async (msg: string) => {
  try {
    // Using the neynarClient to publish the cast.
    await neynarClient.publishCast(SIGNER_UUID, msg);
    console.log("Cast published successfully");
  } catch (err) {
    // Error handling, checking if it's an API response error.
    if (isApiErrorResponse(err)) {
      console.log(err.response.data);
    } else console.log(err);
  }
};

// Function for creating and returning the cast message with the usernames in question
const createMessage = (unameList: Array<object>) => {
  let message = `${unameList.length} new username${unameList.length > 1 ? "s have" : " has"} joined the .eth family!\n`;
  unameList.forEach((unames: object) => {
    message += `@${unames.prevUsername} changed to ${unames.newUsername}!\n`
  });  
};






/**
 * oldData format:
 * [
 *  {
 *    fid:
 *    username:
 *    total_followers:
 *  }
 * ]
 */


/**
 * oldDataChecker format:
 * [
 *  {
 *    fid:
 *    username:
 *  }
 * ]
 */



let oldData: Array<object>;

const cronScheduleFunction = async () => {
  // If first time running, then query dune for the current leaderboard and return tomorrow
  if (!oldData) {
    duneClient
      .refresh(CURRENT_LEADERBOARD_QUERY_ID)
      .then((executionResult) => {
        let oldData = executionResult.result?.rows;
      })
      .catch((err) => {console.log(err)})
    return;
  }

  // Create a string of yesterday's top FIDs in a postgres list format to be passed to dune as a parameter
  let fidList = "(";
  oldData.forEach((record) => {
    fidList += `${record.fid}, `;
  });
  fidList += ")";

  // Put parameter into cowprotocol dune client format
  const parameters = [
    QueryParameter.text("fid_list_parameter", fidList)
  ];

  // Using that parameter, query their current usernames
  await duneClient
    .refresh(USERNAME_LOOKUP_QUERY_ID, parameters)
    .then((executionResult) => {
      let oldDataChecker = executionResult.result?.rows;
    })
    .catch((err) => {console.log(err)})

  // Check which usernames are different ... this code will not work if Dune / postgres rearranges the returned query order
  let differingUsernameUsers: Array<object>
  oldData.forEach((record, i) => {
    // Check if the username is the same. If not, save to var
    if (record.username != oldDataChecker[i].username) {
      differingUsernameUsers.push({prevUsername: record.username, newUsername: oldDataChecker[i].username})
    }
  });

  // Create a message for the differing users - 320 total characters per cast
  if (differingUsernameUsers.length > 0) {
    createMessage(differingUsernameUsers);
  }

  // Cast message
  castMessage("old uname", "new uname"); // <- need to replace 
};


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
  cronScheduleFunction,
  {
    scheduled: true, // Ensure the job is scheduled.
    timezone: TIME_ZONE, // Set the timezone for the schedule.
  }
);

// Logging to inform that the cron job is scheduled.
console.log(
  `Cron job scheduled at ${PUBLISH_CAST_TIME} ${TIME_ZONE}, please don't restart your system before the scheduled time.`
);
