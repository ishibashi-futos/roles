(() => {
  const state = {
    bootId: null,
    hadSuccessfulPoll: false,
    isStopped: false,
  };

  const pollServerState = async () => {
    if (state.isStopped) {
      return;
    }

    try {
      const response = await fetch("/api/dev/server-state", {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
        },
      });

      if (!response.ok) {
        throw new Error("server_state_unavailable");
      }

      const payload = await response.json();
      const nextBootId =
        payload && typeof payload.bootId === "string" ? payload.bootId : null;

      if (!nextBootId) {
        throw new Error("server_state_invalid");
      }

      if (state.bootId && state.bootId !== nextBootId) {
        state.isStopped = true;
        window.location.replace("/");
        return;
      }

      state.bootId = nextBootId;
      state.hadSuccessfulPoll = true;
    } catch {
      if (!state.hadSuccessfulPoll) {
        return;
      }
    }
  };

  window.setInterval(() => {
    void pollServerState();
  }, 1000);

  void pollServerState();
})();
