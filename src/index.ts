import * as core from "@actions/core";
import { run } from "./main";

run().catch((error) => {
  if (error instanceof Error) {
    core.setFailed(error.message);
  } else {
    core.setFailed(String(error));
  }
});
