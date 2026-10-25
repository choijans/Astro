-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('ADD_FAVORITE', 'REMOVE_FAVORITE', 'REFRESH_CHANNEL');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "channels" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "stbNumber" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "genres" TEXT[],
    "languages" TEXT[],
    "rangeKey" TEXT NOT NULL,
    "ranking" INTEGER NOT NULL,
    "schedule" JSONB NOT NULL,
    "scheduleUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favourites" (
    "userId" TEXT NOT NULL,
    "channelId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("userId","channelId")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" INTEGER NOT NULL,
    "type" "CommandType" NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channels_title_idx" ON "channels"("title");

-- CreateIndex
CREATE INDEX "channels_stbNumber_idx" ON "channels"("stbNumber");

-- CreateIndex
CREATE INDEX "channels_category_idx" ON "channels"("category");

-- CreateIndex
CREATE INDEX "favourites_userId_idx" ON "favourites"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "commands_seq_key" ON "commands"("seq");

-- CreateIndex
CREATE INDEX "commands_userId_channelId_type_seq_idx" ON "commands"("userId", "channelId", "type", "seq");

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
