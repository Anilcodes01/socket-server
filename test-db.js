// test-db.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function testDatabase() {
  try {
    // Test connection
    await prisma.$connect();
    console.log('Connected to database');

    // Test user query
    const users = await prisma.user.findMany();
    console.log('Users found:', users.length);

    // Test chat creation
    const testChat = await prisma.chat.create({
      data: {
        userId: users[0].id,
      }
    });
    console.log('Test chat created:', testChat);

    // Test message creation
    const testMessage = await prisma.message.create({
      data: {
        content: 'Test message',
        senderId: users[0].id,
        receiverId: users[1].id,
        chatId: testChat.id,
        read: false,
      }
    });
    console.log('Test message created:', testMessage);

  } catch (error) {
    console.error('Database test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();