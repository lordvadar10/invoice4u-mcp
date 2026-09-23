/**
 * API-key resolution.
 *
 * The key is never a tool argument and never appears in a command line: the
 * macOS Keychain is read through `security`, which writes the secret to stdout
 * only. `INVOICE4U_API_KEY` stays available for CI and containers that have no
 * Keychain.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Invoice4uError } from "./invoice4u/errors.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_KEYCHAIN_SERVICE = "invoice4u";

export interface KeychainLookup {
  service: string;
  account: string;
}

/**
 * Read a generic password from the login keychain.
 *
 * `execFile` is used deliberately — no shell is involved, so the account label
 * cannot be turned into a command.
 */
export async function readKeychainSecret({ service, account }: KeychainLookup): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Invoice4uError({
      kind: "config_error",
      message:
        `INVOICE4U_ACCOUNT uses the macOS Keychain, which is unavailable on ${process.platform}. ` +
        "Set INVOICE4U_API_KEY instead.",
    });
  }

  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { timeout: 10_000, maxBuffer: 64 * 1024 },
    );
    const secret = stdout.replace(/\n$/, "");
    if (secret === "") {
      throw new Invoice4uError({
        kind: "config_error",
        message: `Keychain item ${service}/${account} is empty.`,
      });
    }
    return secret;
  } catch (error) {
    if (error instanceof Invoice4uError) throw error;
    throw new Invoice4uError({
      kind: "config_error",
      message:
        `No Keychain item found for service "${service}", account "${account}". ` +
        `Add one with:  security add-generic-password -s ${service} -a ${account} -U -w`,
    });
  }
}
