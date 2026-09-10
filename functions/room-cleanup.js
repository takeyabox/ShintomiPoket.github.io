"use strict";

const ROOM_INACTIVITY_MS = 15 * 60 * 1000;

function shouldDeleteRoom(room) {
  const players = Object.values(room?.players || {});
  return players.length === 0 || players.every((player) => player?.online !== true);
}

function roomLastActivityAt(room) {
  const timestamps = [room?.lastActivityAt, room?.createdAt];
  for (const player of Object.values(room?.players || {})) {
    timestamps.push(player?.lastSeenAt, player?.joinedAt);
  }
  return timestamps.reduce((latest, value) => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
  }, 0);
}

function shouldDeleteInactiveRoom(room, now = Date.now(), limit = ROOM_INACTIVITY_MS) {
  if (!room || typeof room !== "object") return false;
  const lastActivityAt = roomLastActivityAt(room);
  return lastActivityAt === 0 || Number(now) - lastActivityAt >= limit;
}

module.exports = {
  ROOM_INACTIVITY_MS,
  roomLastActivityAt,
  shouldDeleteInactiveRoom,
  shouldDeleteRoom,
};
