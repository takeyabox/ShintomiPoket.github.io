"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { shouldDeleteInactiveRoom, shouldDeleteRoom } = require("./room-cleanup.js");

initializeApp();

exports.deleteRoomWhenEveryoneDisconnected = onValueWritten({
  ref: "/rooms/{roomNumber}/players/{playerKey}/online",
  instance: "shintomipoket-default-rtdb",
  region: "asia-southeast1",
  memory: "256MiB",
  maxInstances: 5,
}, async (event) => {
  if (!event.data.after.exists() || event.data.after.val() !== false) return;
  const roomRef = event.data.after.ref.parent.parent.parent;
  await roomRef.transaction((room) => shouldDeleteRoom(room) ? null : undefined);
});

exports.deleteInactiveBattleRooms = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Asia/Tokyo",
  region: "asia-southeast1",
  memory: "256MiB",
  maxInstances: 1,
}, async () => {
  const now = Date.now();
  const roomsSnapshot = await getDatabase().ref("rooms").get();
  const cleanups = [];
  roomsSnapshot.forEach((roomSnapshot) => {
    cleanups.push(roomSnapshot.ref.transaction((room) => (
      shouldDeleteInactiveRoom(room, now) ? null : undefined
    )));
  });
  await Promise.all(cleanups);
});
