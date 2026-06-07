const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT) || 3000;

app.use((req, res, next) => {
  if (/\.(?:html|css|js)$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
});

app.use(express.static("public"));

let scoreA = 0;
let scoreB = 0;
let shotA = "";
let shotB = "";
let missionShotsA = ["", "", "", ""];
let missionShotsB = ["", "", "", ""];
let teamNames = ["TEAM A", "TEAM B"];
let teamWeights = {};
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
const liveMatchStateFile = path.join(obsDir, "live-match-state.json");

function cleanTeamName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeTeamWeight(value) {
  if (value === "" || value === null || value === undefined) return null;

  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

function normalizeMissionShots(value) {
  const shots = Array.isArray(value) ? value : [];

  return [0, 1, 2, 3].map((index) => {
    const shotValue = shots[index];

    if (shotValue === "" || shotValue === null || shotValue === undefined) {
      return "";
    }

    return String(shotValue);
  });
}

function normalizeRecordedMissionShots(value) {
  return normalizeMissionShots(value);
}

function getTeamWeight(name) {
  const cleanName = cleanTeamName(name);
  return cleanName ? normalizeTeamWeight(teamWeights[cleanName]) : null;
}

function setTeamWeight(name, weight) {
  const cleanName = cleanTeamName(name);
  const safeWeight = normalizeTeamWeight(weight);
  if (!cleanName || safeWeight === null) return;

  teamWeights[cleanName] = safeWeight;
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
      teamWeights = {};
      teamNames.forEach((teamName) => setTeamWeight(teamName, savedData.teamWeights && savedData.teamWeights[teamName]));
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
    teamWeights,
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

function saveLiveMatchState() {
  const data = {
    scoreA,
    scoreB,
    shotA,
    shotB,
    missionShotsA,
    missionShotsB,
    recordedMissionShotsA: normalizeRecordedMissionShots(missionShotsA),
    recordedMissionShotsB: normalizeRecordedMissionShots(missionShotsB),
    teamNameA,
    teamNameB,
    timeElapsed,
    matchDuration,
    status,
    currentMatchSaved,
    currentMatchSavedResultId,
    savedAt: new Date().toISOString(),
  };

  fs.writeFileSync(liveMatchStateFile, JSON.stringify(data, null, 2));
}

function loadLiveMatchState() {
  if (!fs.existsSync(liveMatchStateFile)) return;

  try {
    const savedData = JSON.parse(fs.readFileSync(liveMatchStateFile, "utf8"));
    const savedDuration = Number(savedData.matchDuration);
    const savedElapsed = Number(savedData.timeElapsed);
    const savedScoreA = Number(savedData.scoreA);
    const savedScoreB = Number(savedData.scoreB);
    const savedStatus = String(savedData.status || "STOP").toUpperCase();
    const validStatuses = new Set(["STOP", "RUNNING", "FINISH"]);

    scoreA = Number.isFinite(savedScoreA) ? Math.max(Math.floor(savedScoreA), 0) : 0;
    scoreB = Number.isFinite(savedScoreB) ? Math.max(Math.floor(savedScoreB), 0) : 0;
    matchDuration = Number.isFinite(savedDuration) && savedDuration > 0 ? Math.floor(savedDuration) : 180;
    timeElapsed = Number.isFinite(savedElapsed) ? Math.min(Math.max(Math.floor(savedElapsed), 0), matchDuration) : 0;
    shotA = String(savedData.shotA || "");
    shotB = String(savedData.shotB || "");
    const hasRecordedMissionShotsA = Array.isArray(savedData.recordedMissionShotsA);
    const hasRecordedMissionShotsB = Array.isArray(savedData.recordedMissionShotsB);
    missionShotsA = normalizeRecordedMissionShots(hasRecordedMissionShotsA ? savedData.recordedMissionShotsA : savedData.missionShotsA);
    missionShotsB = normalizeRecordedMissionShots(hasRecordedMissionShotsB ? savedData.recordedMissionShotsB : savedData.missionShotsB);
    teamNameA = addTeamNameToList(savedData.teamNameA || teamNameA) || teamNameA;
    teamNameB = addTeamNameToList(savedData.teamNameB || teamNameB) || teamNameB;
    status = validStatuses.has(savedStatus) ? savedStatus : "STOP";

    const finishTime = formatTime(matchDuration);
    if (!hasRecordedMissionShotsA && status === "FINISH" && shotA === finishTime && missionShotsA[3] === finishTime) {
      missionShotsA[3] = "";
    }

    if (!hasRecordedMissionShotsB && status === "FINISH" && shotB === finishTime && missionShotsB[3] === finishTime) {
      missionShotsB[3] = "";
    }

    if (status === "RUNNING") {
      status = "STOP";
    }

    const savedResultId = String(savedData.currentMatchSavedResultId || "");
    currentMatchSaved = Boolean(
      savedData.currentMatchSaved &&
      savedResultId &&
      matchResults.some((result) => result && result.id === savedResultId)
    );
    currentMatchSavedResultId = currentMatchSaved ? savedResultId : "";
  } catch (error) {
    console.warn("Could not read live match state:", error.message);
  }
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

function getWinnerInfoFromValues(firstScore, secondScore, firstShot, secondShot, firstWeight, secondWeight, firstName, secondName) {
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

  const safeWeightA = normalizeTeamWeight(firstWeight);
  const safeWeightB = normalizeTeamWeight(secondWeight);
  const shotTimesAreEqual = shotSecondsA !== null && shotSecondsB !== null && shotSecondsA === shotSecondsB;

  if (shotTimesAreEqual && safeWeightA !== null && safeWeightB !== null) {
    if (safeWeightA < safeWeightB) {
      return {
        winner: "A",
        winnerName: firstName || "TEAM A",
      };
    }

    if (safeWeightB < safeWeightA) {
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
  return getWinnerInfoFromValues(
    scoreA,
    scoreB,
    shotA,
    shotB,
    getTeamWeight(teamNameA),
    getTeamWeight(teamNameB),
    teamNameA,
    teamNameB
  );
}

function normalizeMatchResult(result) {
  const safeResult = result && typeof result === "object" ? result : {};
  const winnerInfo = getWinnerInfoFromValues(
    safeResult.scoreA,
    safeResult.scoreB,
    safeResult.shotA,
    safeResult.shotB,
    safeResult.teamWeightA,
    safeResult.teamWeightB,
    safeResult.teamNameA,
    safeResult.teamNameB
  );

  return {
    ...safeResult,
    winner: winnerInfo.winner,
    winnerName: winnerInfo.winnerName,
  };
}

function getCurrentMatchResultFields() {
  const winnerInfo = getWinnerInfo();

  return {
    teamNameA,
    teamNameB,
    teamWeightA: getTeamWeight(teamNameA),
    teamWeightB: getTeamWeight(teamNameB),
    scoreA,
    scoreB,
    shotA,
    shotB,
    missionShotsA: normalizeMissionShots(missionShotsA),
    missionShotsB: normalizeMissionShots(missionShotsB),
    elapsedSeconds: timeElapsed,
    elapsedTime: formatTime(timeElapsed),
    matchDuration,
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
  const result = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    matchNumber: getNextMatchNumber(),
    savedAt: new Date().toISOString(),
    mode: saveMode,
    ...getCurrentMatchResultFields(),
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

function updateCurrentMatchResult() {
  if (!currentMatchSaved || !currentMatchSavedResultId) return false;

  const resultIndex = matchResults.findIndex((result) => result && result.id === currentMatchSavedResultId);
  if (resultIndex === -1) return false;

  matchResults[resultIndex] = {
    ...matchResults[resultIndex],
    ...getCurrentMatchResultFields(),
  };
  saveMatchResults();
  return true;
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

function editTeamName(oldName, newName, weight) {
  const cleanOldName = cleanTeamName(oldName);
  const cleanNewName = cleanTeamName(newName);
  const index = findTeamNameIndex(cleanOldName);

  if (index === -1 || !cleanNewName) return;

  const duplicateIndex = findTeamNameIndex(cleanNewName);
  if (duplicateIndex !== -1 && duplicateIndex !== index) {
    setTeamWeight(teamNames[duplicateIndex], weight);
    if (teamNameA === teamNames[index]) teamNameA = teamNames[duplicateIndex];
    if (teamNameB === teamNames[index]) teamNameB = teamNames[duplicateIndex];
    delete teamWeights[teamNames[index]];
    teamNames.splice(index, 1);
  } else {
    const previousName = teamNames[index];
    teamNames[index] = cleanNewName;
    const previousWeight = getTeamWeight(previousName);
    delete teamWeights[previousName];
    setTeamWeight(cleanNewName, weight === undefined ? previousWeight : weight);
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
  delete teamWeights[deletedName];

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
  normalizeMissionShots(missionShotsA).forEach((shot, index) => {
    fs.writeFileSync(path.join(obsDir, `mission_shot_a_${index + 1}.txt`), shot);
  });
  normalizeMissionShots(missionShotsB).forEach((shot, index) => {
    fs.writeFileSync(path.join(obsDir, `mission_shot_b_${index + 1}.txt`), shot);
  });
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
    missionShotsA: normalizeMissionShots(missionShotsA),
    missionShotsB: normalizeMissionShots(missionShotsB),
    recordedMissionShotsA: normalizeRecordedMissionShots(missionShotsA),
    recordedMissionShotsB: normalizeRecordedMissionShots(missionShotsB),
    teamNames,
    teamWeights,
    teamNameA,
    teamNameB,
    teamWeightA: getTeamWeight(teamNameA),
    teamWeightB: getTeamWeight(teamNameB),
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
  saveLiveMatchState();
  writeObsFiles();
}

function fillMissingShotsWithFinishTime() {
  const finishTime = formatTime(matchDuration);

  if (shotA === "") {
    shotA = finishTime;
  }

  if (shotB === "") {
    shotB = finishTime;
  }
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
      fillMissingShotsWithFinishTime();
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
  missionShotsA = ["", "", "", ""];
  missionShotsB = ["", "", "", ""];
  status = "STOP";
  resetCurrentMatchSave();
  sendUpdate();
}

function addScore(team, point, options = {}) {
  if (!Number.isFinite(point)) return;
  if (status === "FINISH" && !options.allowAfterFinish) return;

  if (team === "A") {
    scoreA += point;
    if (scoreA < 0) scoreA = 0;
  }

  if (team === "B") {
    scoreB += point;
    if (scoreB < 0) scoreB = 0;
  }
}

function hasRecordedShot(team) {
  return (team === "A" && shotA !== "") || (team === "B" && shotB !== "");
}

function getMissionShotList(team) {
  if (team === "A") return missionShotsA;
  if (team === "B") return missionShotsB;
  return null;
}

function hasRecordedMissionShot(team, mission) {
  const shots = getMissionShotList(team);
  const missionIndex = Number(mission) - 1;

  return Boolean(shots && missionIndex >= 0 && missionIndex < 4 && shots[missionIndex] !== "");
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

function recordMissionShot(team, mission, options = {}) {
  const shots = getMissionShotList(team);
  const missionIndex = Number(mission) - 1;
  const canRecordAfterFinish = options.allowAfterFinish && missionIndex === 3;

  if (status === "FINISH" && !canRecordAfterFinish) return false;
  if (!shots || missionIndex < 0 || missionIndex >= 4 || shots[missionIndex] !== "") return false;

  const shotTime = formatTime(timeElapsed);
  shots[missionIndex] = shotTime;

  if (missionIndex === 3) {
    if (team === "A" && shotA === "") shotA = shotTime;
    if (team === "B" && shotB === "") shotB = shotTime;
  }

  return true;
}

io.on("connection", (socket) => {
  sendUpdate();

  socket.on("add-score", (data) => {
    const team = data.team;
    const point = Number(data.point);

    addScore(team, point);
    sendUpdate();
  });

  socket.on("mission-score", (data) => {
    const team = data && data.team;
    const point = Number(data && data.point);
    const mission = Number(data && data.mission);

    if (!Number.isFinite(point) || !Number.isFinite(mission) || mission < 1 || mission > 4) {
      sendUpdate();
      return;
    }

    if (status === "FINISH" || hasRecordedMissionShot(team, mission)) {
      sendUpdate();
      return;
    }

    addScore(team, point);
    recordMissionShot(team, mission);
    sendUpdate();
  });

  socket.on("end-with-bonus", (data) => {
    const team = data.team;
    const point = Number(data.point);
    const safePoint = Number.isFinite(point) ? point : 20;

    if (hasRecordedMissionShot(team, 4)) {
      sendUpdate();
      return;
    }

    if (!recordMissionShot(team, 4, { allowAfterFinish: true })) {
      sendUpdate();
      return;
    }

    addScore(team, safePoint, { allowAfterFinish: true });

    if (status === "FINISH") {
      updateCurrentMatchResult();
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
    if (status === "RUNNING") {
      sendUpdate();
      return;
    }

    scoreA = 0;
    scoreB = 0;
    shotA = "";
    shotB = "";
    missionShotsA = ["", "", "", ""];
    missionShotsB = ["", "", "", ""];
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

  socket.on("force-sync", (callback) => {
    sendUpdate();

    if (typeof callback === "function") {
      callback({
        synced: true,
      });
    }
  });

  socket.on("team-name-add", (data) => {
    const teamName = addTeamNameToList(data && data.name);
    if (teamName) {
      setTeamWeight(teamName, data && data.weight);
      saveTeamNameData();
      sendUpdate();
    }
  });

  socket.on("team-name-edit", (data) => {
    editTeamName(data && data.oldName, data && data.newName, data && data.weight);
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
loadLiveMatchState();
saveTeamNameData();
saveMatchResults();
saveLiveMatchState();
writeObsFiles();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
