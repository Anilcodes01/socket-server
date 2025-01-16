require("dotenv").config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

// Add basic health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

const io = new Server(httpServer, {
  cors: {
    origin: [
      process.env.CLIENT_URL || "http://localhost:3000",
      "https://websockets.vercel.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"]
});

const userSocketMap = new Map();

// Enhanced database connection test
async function testConnection() {
  try {
    await prisma.$connect();
    console.log("Successfully connected to database");
    
    // Test query to ensure full connectivity
    const userCount = await prisma.user.count();
    console.log(`Database connection verified. Current user count: ${userCount}`);
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
}

testConnection();

// Middleware to log all incoming socket events
io.use((socket, next) => {
  console.log(`New connection attempt - Socket ID: ${socket.id}`);
  console.log('Handshake details:', {
    headers: socket.handshake.headers,
    query: socket.handshake.query,
    auth: socket.handshake.auth
  });
  next();
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("register", (userId) => {
    if (!userId) {
      console.error("Register attempt with invalid userId:", userId);
      return;
    }

    if (!userSocketMap.has(userId)) {
      userSocketMap.set(userId, new Set());
    }
    userSocketMap.get(userId).add(socket.id);
    socket.data.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
    
    // Acknowledge registration
    socket.emit("registered", { status: "success", socketId: socket.id });
  });

  socket.on("sendMessage", async (message) => {
    console.log("Received message:", message);
    const { content, senderId, receiverId } = message;

    if (!content || !senderId || !receiverId) {
      console.error("Invalid message format:", message);
      socket.emit("messageError", { error: "Invalid message format" });
      return;
    }

    const isReceiverOnline = userSocketMap.has(receiverId) && 
                            userSocketMap.get(receiverId).size > 0;
    console.log(`Receiver ${receiverId} online status:`, isReceiverOnline);

    try {
      // Find or create a chat
      let chat = await prisma.chat.findFirst({
        where: {
          OR: [
            {
              userId: senderId,
              messages: {
                some: {
                  OR: [
                    { senderId, receiverId },
                    { senderId: receiverId, receiverId: senderId },
                  ],
                },
              },
            },
            {
              userId: receiverId,
              messages: {
                some: {
                  OR: [
                    { senderId, receiverId },
                    { senderId: receiverId, receiverId: senderId },
                  ],
                },
              },
            },
          ],
        },
      });

      if (!chat) {
        chat = await prisma.chat.create({
          data: {
            userId: senderId,
          },
        });
        console.log("Created new chat:", chat.id);
      }

      // Create the message
      const savedMessage = await prisma.message.create({
        data: {
          content,
          senderId,
          receiverId,
          chatId: chat.id,
          read: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      console.log("Message saved:", savedMessage.id);

      // Emit to sender
      socket.emit("messageSaved", savedMessage);

      // Emit to receiver if online
      if (isReceiverOnline) {
        const receiverSockets = userSocketMap.get(receiverId);
        console.log(`Emitting to receiver sockets:`, Array.from(receiverSockets));
        
        receiverSockets.forEach((socketId) => {
          io.to(socketId).emit("receiveMessage", savedMessage);
        });
      }

    } catch (error) {
      console.error("Error processing message:", error);
      socket.emit("messageError", {
        error: "Failed to process message",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId;
    console.log(`Client disconnected: ${socket.id}, userId: ${userId}`);
    
    if (userId) {
      const userSockets = userSocketMap.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          userSocketMap.delete(userId);
        }
        console.log(`Updated socket map for user ${userId}:`, 
          userSockets.size ? Array.from(userSockets) : "No active sockets");
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});