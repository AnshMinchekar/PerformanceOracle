function gracefulShutdown(server) {
  const SHUTDOWN_TIMEOUT = 10000; // 10 seconds

  return () => {
    console.log("\n=====================================");
    console.log("Graceful shutdown initiated");

    server.close(() => {
      console.log("HTTP server closed");
      console.log("=====================================");

      // Perform any additional cleanup here if necessary
      process.exit(0);
    });

    // Forcefully shut down after the timeout if not closed
    setTimeout(() => {
      console.error("Forcing shutdown due to timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);
  };
}

module.exports = gracefulShutdown;
