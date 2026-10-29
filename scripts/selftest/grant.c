// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The grant a system panel gives a sandboxed app, issued by the native
// self-test's driver (scripts/selftest.mjs) for the sandboxed self-test
// (src-tauri/src/selftest_sandbox.rs, docs/engineering/release-engineering.md#REL-56).
//
//   grant read-write <path>    the folder panel's, the Save panel's, or Finder's for a document the app edits
//   grant read <path>          Finder's for a document the app only reads
//
// Prints a sandbox extension for that one path, the kind the panel's own
// process issues and the app consumes: a folder's covers what is inside it, a
// file's covers that file alone, made or replaced. Built by the driver when a
// run needs it; never part of the app.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *sandbox_extension_issue_file(const char *extension_class, const char *path, uint32_t flags);

int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "read-write") && strcmp(argv[1], "read"))) {
    fprintf(stderr, "usage: grant read-write|read <path>\n");
    return 2;
  }
  const char *cls = strcmp(argv[1], "read") ? "com.apple.app-sandbox.read-write" : "com.apple.app-sandbox.read";
  char *token = sandbox_extension_issue_file(cls, argv[2], 0);
  if (!token) {
    perror("sandbox_extension_issue_file");
    return 1;
  }
  printf("%s\n", token);
  free(token);
  return 0;
}
