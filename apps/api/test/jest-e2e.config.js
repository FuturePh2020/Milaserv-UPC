module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.e2e-spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  testEnvironment: "node",
  testTimeout: 30000,
  // Real Redis/BullMQ/socket.io connections in these specs leave a handle or
  // two open past test completion (pool keep-alives, ping timers) even with
  // correct teardown; force-exit once results are in rather than hang.
  forceExit: true,
  moduleNameMapper: {
    "^@lcrm/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
};
