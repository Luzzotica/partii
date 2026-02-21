"use client";

import { useGyriiStore } from "../store/gameStore";
import { useGyriiConnection } from "../hooks/useGyriiConnection";

export default function PauseMenu() {
  const { setGameState, setCurrentLobby, setPendingLeaveLobby } =
    useGyriiStore();
  const { leaveLobby } = useGyriiConnection();

  const handleResume = () => {
    setGameState("playing");
  };

  const handleQuit = async () => {
    setPendingLeaveLobby(true);
    setCurrentLobby(null);
    setGameState("loading");
    await leaveLobby();
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm z-50">
      <div className="bg-gray-900/95 border border-cyan-500/30 rounded-lg p-8 max-w-md w-full mx-4">
        <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500 mb-6 text-center">
          PAUSED
        </h2>

        <div className="space-y-4">
          <button
            onClick={handleResume}
            className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-pink-500 text-white font-bold rounded-lg hover:from-cyan-400 hover:to-pink-400 transition-all duration-200 transform hover:scale-105"
          >
            Resume
          </button>

          <button
            onClick={handleQuit}
            className="w-full py-3 px-6 bg-gray-700 text-white font-bold rounded-lg hover:bg-gray-600 transition-all duration-200"
          >
            Quit to Menu
          </button>
        </div>

        <p className="text-gray-400 text-sm text-center mt-6">
          Press ESC to resume
        </p>
      </div>
    </div>
  );
}
