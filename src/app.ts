import cron from "node-cron";
import neynarClient from "./neynarClient";
import duneClient from "./duneClient";
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
const QUERY_ID = 3380826; // <- temp query ID; need to replace with real query

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

// Function to refresh Dune query
const getQueryResults = (query_id) => {
  duneClient
    .refresh(query_id)
    .then((executionResult) => {
      return executionResult.result?.rows
    });
}

// Function for creating and returning the cast message with the usernames in question
const createMessage = (prevUsername: string, newUsername: string) => {
  return `@${prevUsername} has changed their username to ${newUsername}!`;
};

// Function for casting the announcement
const castMessage = (prevUsername: string, newUsername: string) => {
  const message = createMessage(prevUsername, newUsername);
  publishCast(message);
};




const cronScheduleFunction = () => {
  // Get query results
  const newData = getQueryResults();
  // Check who is new

  // Create a message for them

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
