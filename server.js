const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;

app.use(express.static("public"));

let scoreA = 0;
let scoreB = 0;

let timeLeft = 180; // เริ่มต้น 3 นาที
let matchDuration = 180;
let timer = null;
let status = "STOP";

const obsDir = path.join(__dirname, "obs");

if (!fs.existsSync(obsDir)) {
  fs.mkdirSync(obsDir);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function writeObsFiles() {
  fs.writeFileSync(path.join(obsDir, "score_a.txt"), String(scoreA));
  fs.writeFileSync(path.join(obsDir, "score_b.txt"), String(scoreB));
  fs.writeFileSync(path.join(obsDir, "time.txt"), formatTime(timeLeft));
  fs.writeFileSync(path.join(obsDir, "status.txt"), status);
}

function sendUpdate() {
  const data = {
    scoreA,
    scoreB,
    time: formatTime(timeLeft),
    status,
  };

  io.emit("update", data);
  writeObsFiles();
}

function startTimer() {
  if (timer !== null) return;

  if (timeLeft <= 0) {
    timeLeft = matchDuration;
  }

  status = "RUNNING";

  timer = setInterval(() => {
    if (timeLeft > 0) {
      timeLeft--;
      sendUpdate();
    } else {
      clearInterval(timer);
      timer = null;
      status = "FINISH";
      sendUpdate();
    }
  }, 1000);

  sendUpdate();
}

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }

  status = "STOP";
  sendUpdate();
}

function resetTimer(seconds = 180) {
  const nextTime = Number(seconds);
  const safeTime = Number.isFinite(nextTime) && nextTime > 0 ? nextTime : 180;

  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }

  matchDuration = safeTime;
  timeLeft = safeTime;
  status = "STOP";
  sendUpdate();
}

io.on("connection", (socket) => {
  sendUpdate();

  socket.on("add-score", (data) => {
    const team = data.team;
    const point = Number(data.point);

    if (team === "A") {
      scoreA += point;
      if (scoreA < 0) scoreA = 0;
    }

    if (team === "B") {
      scoreB += point;
      if (scoreB < 0) scoreB = 0;
    }

    sendUpdate();
  });

  socket.on("set-time", (seconds) => {
    resetTimer(Number(seconds));
  });

  socket.on("start-time", () => {
    startTimer();
  });

  socket.on("stop-time", () => {
    stopTimer();
  });

  socket.on("reset-score", () => {
    scoreA = 0;
    scoreB = 0;
    sendUpdate();
  });

  socket.on("reset-all", () => {
    scoreA = 0;
    scoreB = 0;
    resetTimer(180);
    sendUpdate();
  });
});

writeObsFiles();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
