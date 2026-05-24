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
let shotA = "";
let shotB = "";
let teamNames = ["TEAM A", "TEAM B"];
let teamNameA = "TEAM A";
let teamNameB = "TEAM B";
let teamNamesVisible = true;
let matchResults = [];
let currentMatchSaved = false;
let currentMatchSavedResultId = "";

let timeElapsed = 0;
let matchDuration = 180;
let timer = null;
let status = "STOP";

const obsDir = path.join(__dirname, "obs");

if (!fs.existsSync(obsDir)) {
  fs.mkdirSync(obsDir);
}

const teamDataFile = path.join(obsDir, "team-names.json");
const matchResultsFile = path.join(obsDir, "match-results.json");

function cleanTeamName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function findTeamNameIndex(name) {
  const cleanName = cleanTeamName(name).toLocaleLowerCase();
  return teamNames.findIndex((teamName) => teamName.toLocaleLowerCase() === cleanName);
}

function addTeamNameToList(name) {
  const cleanName = cleanTeamName(name);
  if (!cleanName) return "";

  const existingIndex = findTeamNameIndex(cleanName);
  if (existingIndex === -1) {
    teamNames.push(cleanName);
    return cleanName;
  }

  return teamNames[existingIndex];
}

function normalizeTeamList(names) {
  teamNames = [];

  if (Array.isArray(names)) {
    names.forEach((name) => addTeamNameToList(name));
  }

  if (teamNames.length === 0) {
    teamNames = ["TEAM A", "TEAM B"];
  }
}

function readTextFileIfExists(fileName) {
  const filePath = path.join(obsDir, fileName);
  if (!fs.existsSync(filePath)) return "";
  return cleanTeamName(fs.readFileSync(filePath, "utf8"));
}

function loadTeamNameData() {
  if (fs.existsSync(teamDataFile)) {
    try {
      const savedData = JSON.parse(fs.readFileSync(teamDataFile, "utf8"));
      normalizeTeamList(savedData.teamNames);
      teamNameA = cleanTeamName(savedData.teamNameA) || teamNames[0] || "TEAM A";
      teamNameB = cleanTeamName(savedData.teamNameB) || teamNames[1] || teamNames[0] || "TEAM B";
      teamNamesVisible = typeof savedData.teamNamesVisible === "boolean" ? savedData.teamNamesVisible : true;
      teamNameA = addTeamNameToList(teamNameA);
      teamNameB = addTeamNameToList(teamNameB);
      return;
    } catch (error) {
      console.warn("Could not read team name data:", error.message);
    }
  }

  const savedNameA = readTextFileIfExists("team-name-a.text");
  const savedNameB = readTextFileIfExists("team-name-b.text");
  teamNameA = addTeamNameToList(savedNameA || "TEAM A");
  teamNameB = addTeamNameToList(savedNameB || "TEAM B");
}

function saveTeamNameData() {
  const data = {
    teamNames,
    teamNameA,
    teamNameB,
    teamNamesVisible,
  };

  fs.writeFileSync(teamDataFile, JSON.stringify(data, null, 2));
}

function loadMatchResults() {
  if (!fs.existsSync(matchResultsFile)) return;

  try {
    const savedData = JSON.parse(fs.readFileSync(matchResultsFile, "utf8"));
    matchResults = Array.isArray(savedData) ? savedData.map(normalizeMatchResult) : [];
  } catch (error) {
    console.warn("Could not read match results:", error.message);
    matchResults = [];
  }
}

function saveMatchResults() {
  fs.writeFileSync(matchResultsFile, JSON.stringify(matchResults, null, 2));
}

function resetCurrentMatchSave() {
  currentMatchSaved = false;
  currentMatchSavedResultId = "";
}

function getNextMatchNumber() {
  return matchResults.reduce((highestNumber, result) => {
    const matchNumber = Number(result && result.matchNumber);
    return Number.isFinite(matchNumber) ? Math.max(highestNumber, matchNumber) : highestNumber;
  }, 0) + 1;
}

function parseShotTime(value) {
  const match = String(value || "").trim().match(/^(\d+)[.:](\d{2})$/);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;

  return minutes * 60 + seconds;
}

function getWinnerInfoFromValues(firstScore, secondScore, firstShot, secondShot, firstName, secondName) {
  const safeScoreA = Number(firstScore) || 0;
  const safeScoreB = Number(secondScore) || 0;

  if (safeScoreA > safeScoreB) {
    return {
      winner: "A",
      winnerName: firstName || "TEAM A",
    };
  }

  if (safeScoreB > safeScoreA) {
    return {
      winner: "B",
      winnerName: secondName || "TEAM B",
    };
  }

  const shotSecondsA = parseShotTime(firstShot);
  const shotSecondsB = parseShotTime(secondShot);

  if (shotSecondsA !== null && shotSecondsB !== null) {
    if (shotSecondsA < shotSecondsB) {
      return {
        winner: "A",
        winnerName: firstName || "TEAM A",
      };
    }

    if (shotSecondsB < shotSecondsA) {
      return {
        winner: "B",
        winnerName: secondName || "TEAM B",
      };
    }
  }

  return {
    winner: "DRAW",
    winnerName: "DRAW",
  };
}

function getWinnerInfo() {
  return getWinnerInfoFromValues(scoreA, scoreB, shotA, shotB, teamNameA, teamNameB);
}

function normalizeMatchResult(result) {
  const safeResult = result && typeof result === "object" ? result : {};
  const winnerInfo = getWinnerInfoFromValues(
    safeResult.scoreA,
    safeResult.scoreB,
    safeResult.shotA,
    safeResult.shotB,
    safeResult.teamNameA,
    safeResult.teamNameB
  );

  return {
    ...safeResult,
    winner: winnerInfo.winner,
    winnerName: winnerInfo.winnerName,
  };
}

function saveCurrentMatchResult(mode) {
  if (currentMatchSaved) {
    return {
      saved: false,
      result: matchResults.find((result) => result.id === currentMatchSavedResultId) || null,
    };
  }

  const saveMode = mode === "auto" ? "auto" : "manual";
  const winnerInfo = getWinnerInfo();
  const result = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    matchNumber: getNextMatchNumber(),
    savedAt: new Date().toISOString(),
    mode: saveMode,
    teamNameA,
    teamNameB,
    scoreA,
    scoreB,
    shotA,
    shotB,
    elapsedSeconds: timeElapsed,
    elapsedTime: formatTime(timeElapsed),
    matchDuration,
    winner: winnerInfo.winner,
    winnerName: winnerInfo.winnerName,
  };

  matchResults = [result, ...matchResults].slice(0, 200);
  currentMatchSaved = true;
  currentMatchSavedResultId = result.id;
  saveMatchResults();

  return {
    saved: true,
    result,
  };
}

function deleteMatchResult(id) {
  const resultId = String(id || "").trim();
  if (!resultId) return false;

  const beforeLength = matchResults.length;
  matchResults = matchResults.filter((result) => result && result.id !== resultId);
  const deleted = matchResults.length !== beforeLength;

  if (deleted) {
    if (currentMatchSavedResultId === resultId) {
      resetCurrentMatchSave();
    }

    saveMatchResults();
  }

  return deleted;
}

function finishMatchWithResult(mode) {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }

  status = "FINISH";
  return saveCurrentMatchResult(mode);
}

function setTeamNamesVisible(visible) {
  teamNamesVisible = Boolean(visible);
  saveTeamNameData();
  sendUpdate();
}

function setTeamName(team, name) {
  const teamName = addTeamNameToList(name);
  if (!teamName) return;

  if (team === "A") {
    teamNameA = teamName;
  }

  if (team === "B") {
    teamNameB = teamName;
  }

  saveTeamNameData();
  sendUpdate();
}

function editTeamName(oldName, newName) {
  const cleanOldName = cleanTeamName(oldName);
  const cleanNewName = cleanTeamName(newName);
  const index = findTeamNameIndex(cleanOldName);

  if (index === -1 || !cleanNewName) return;

  const duplicateIndex = findTeamNameIndex(cleanNewName);
  if (duplicateIndex !== -1 && duplicateIndex !== index) {
    if (teamNameA === teamNames[index]) teamNameA = teamNames[duplicateIndex];
    if (teamNameB === teamNames[index]) teamNameB = teamNames[duplicateIndex];
    teamNames.splice(index, 1);
  } else {
    const previousName = teamNames[index];
    teamNames[index] = cleanNewName;
    if (teamNameA === previousName) teamNameA = cleanNewName;
    if (teamNameB === previousName) teamNameB = cleanNewName;
  }

  saveTeamNameData();
  sendUpdate();
}

function deleteTeamName(name) {
  const cleanName = cleanTeamName(name);
  const index = findTeamNameIndex(cleanName);
  if (index === -1 || teamNames.length <= 1) return;

  const deletedName = teamNames[index];
  teamNames.splice(index, 1);

  if (teamNameA === deletedName) {
    teamNameA = teamNames.find((teamName) => teamName !== teamNameB) || teamNames[0] || "TEAM A";
  }

  if (teamNameB === deletedName) {
    teamNameB = teamNames.find((teamName) => teamName !== teamNameA) || teamNames[0] || "TEAM B";
  }

  saveTeamNameData();
  sendUpdate();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}.${String(s).padStart(2, "0")}`;
}

function writeObsFiles() {
  fs.writeFileSync(path.join(obsDir, "score_a.txt"), String(scoreA));
  fs.writeFileSync(path.join(obsDir, "score_b.txt"), String(scoreB));
  fs.writeFileSync(path.join(obsDir, "time.txt"), formatTime(timeElapsed));
  fs.writeFileSync(path.join(obsDir, "shot_a.txt"), shotA);
  fs.writeFileSync(path.join(obsDir, "shot_b.txt"), shotB);
  fs.writeFileSync(path.join(obsDir, "status.txt"), status);
  fs.writeFileSync(path.join(obsDir, "team-name-a.text"), teamNamesVisible ? teamNameA : "");
  fs.writeFileSync(path.join(obsDir, "team-name-b.text"), teamNamesVisible ? teamNameB : "");
}

function sendUpdate() {
  const remainingSeconds = Math.max(matchDuration - timeElapsed, 0);
  const data = {
    scoreA,
    scoreB,
    shotA,
    shotB,
    teamNames,
    teamNameA,
    teamNameB,
    teamNamesVisible,
    matchResults,
    currentMatchSaved,
    currentMatchSavedResultId,
    time: formatTime(timeElapsed),
    timeElapsed,
    matchDuration,
    remainingSeconds,
    status,
  };

  io.emit("update", data);
  writeObsFiles();
}

function startTimer() {
  if (timer !== null) return;
  if (status === "FINISH") {
    sendUpdate();
    return;
  }

  if (timeElapsed >= matchDuration) {
    timeElapsed = 0;
  }

  status = "RUNNING";

  timer = setInterval(() => {
    if (timeElapsed < matchDuration) {
      timeElapsed++;
    }

    if (timeElapsed >= matchDuration) {
      clearInterval(timer);
      timer = null;
      status = "FINISH";
      saveCurrentMatchResult("auto");
    }

    sendUpdate();
  }, 1000);

  sendUpdate();
}

function stopTimer() {
  if (status === "FINISH") {
    sendUpdate();
    return;
  }

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
  timeElapsed = 0;
  shotA = "";
  shotB = "";
  status = "STOP";
  resetCurrentMatchSave();
  sendUpdate();
}

function addScore(team, point) {
  if (!Number.isFinite(point)) return;
  if (status === "FINISH") return;
  if (team === "A" && shotA !== "") return;
  if (team === "B" && shotB !== "") return;

  if (team === "A") {
    scoreA += point;
    if (scoreA < 0) scoreA = 0;
  }

  if (team === "B") {
    scoreB += point;
    if (scoreB < 0) scoreB = 0;
  }
}

function recordShot(team) {
  if (status === "FINISH") return;

  if (team === "A" && shotA === "") {
    shotA = formatTime(timeElapsed);
  }

  if (team === "B" && shotB === "") {
    shotB = formatTime(timeElapsed);
  }

  sendUpdate();
}

io.on("connection", (socket) => {
  sendUpdate();

  socket.on("add-score", (data) => {
    const team = data.team;
    const point = Number(data.point);

    addScore(team, point);
    sendUpdate();
  });

  socket.on("end-with-bonus", (data) => {
    const team = data.team;
    const point = Number(data.point);
    const safePoint = Number.isFinite(point) ? point : 20;

    addScore(team, safePoint);
    recordShot(team);
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
    if (status === "RUNNING") {
      sendUpdate();
      return;
    }

    scoreA = 0;
    scoreB = 0;
    shotA = "";
    shotB = "";
    timeElapsed = 0;
    status = "STOP";
    resetCurrentMatchSave();
    sendUpdate();
  });

  socket.on("reset-all", () => {
    scoreA = 0;
    scoreB = 0;
    resetTimer(180);
    sendUpdate();
  });

  socket.on("team-name-add", (data) => {
    if (addTeamNameToList(data && data.name)) {
      saveTeamNameData();
      sendUpdate();
    }
  });

  socket.on("team-name-edit", (data) => {
    editTeamName(data && data.oldName, data && data.newName);
  });

  socket.on("team-name-select", (data) => {
    setTeamName(data && data.team, data && data.name);
  });

  socket.on("team-name-delete", (data) => {
    deleteTeamName(data && data.name);
  });

  socket.on("team-names-show", () => {
    setTeamNamesVisible(true);
  });

  socket.on("team-names-hide", () => {
    setTeamNamesVisible(false);
  });

  socket.on("match-result-save", (callback) => {
    const saveMode = timeElapsed >= matchDuration ? "auto" : "manual";
    const saveResult = finishMatchWithResult(saveMode);
    sendUpdate();

    if (typeof callback === "function") {
      callback(saveResult);
    }
  });

  socket.on("match-result-delete", (data, callback) => {
    const deleted = deleteMatchResult(data && data.id);
    sendUpdate();

    if (typeof callback === "function") {
      callback({
        deleted,
        matchResults,
      });
    }
  });
});

loadTeamNameData();
loadMatchResults();
saveTeamNameData();
saveMatchResults();
writeObsFiles();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
