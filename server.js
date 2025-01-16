const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "https://wesockets.vercel.app/",
    methods: ["GET", "POST"],
  },
});

const userSocketMap = new Map();

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userSocketMap.has(userId)) {
      userSocketMap.set(userId, new Set());
    }
    userSocketMap.get(userId).add(socket.id);
    socket.data.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  socket.on("sendMessage", async (message) => {
    const { content, senderId, receiverId } = message;

    const isReceiverOnline =
      userSocketMap.has(receiverId) && userSocketMap.get(receiverId).size > 0;

    try {
      const savedMessage = await prisma.message.create({
        data: {
          content,
          senderId,
          receiverId,
          status: isReceiverOnline ? "delivered" : "sent",
        },
      });

      if (isReceiverOnline) {
        userSocketMap.get(receiverId).forEach((socketId) => {
          io.to(socketId).emit("receiveMessage", {
            ...savedMessage,
            isDelivered: true,
          });
        });
      }
      socket.emit("receiveMessage", {
        ...savedMessage,
        isDelivered: isReceiverOnline,
      });
    } catch (error) {
      console.error("Error saving message:", error);
      socket.emit("messageError", {
        error: "Failed to send message",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;
    if (userId) {
      const userSockets = userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          userSocketMap.delete(userId);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
