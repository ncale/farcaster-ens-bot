import { DuneClient } from "@cowprotocol/ts-dune-client";
import { DUNE_API_KEY } from "./config";

const duneClient = new DuneClient(DUNE_API_KEY);

export default duneClient;
