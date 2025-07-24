import express from 'express'
import databaseService from './config/database.service'
import { getEnvConfig } from './config/getEnvConfig'
import { ObjectId } from 'mongodb'
getEnvConfig()
const app = express()
databaseService.messages.insertOne({
  _id: new ObjectId(),
  conversation_id: new ObjectId(),
  conversation_type: 'direct',
  sender_id: new ObjectId(),
  content: 'Hello, world!',
  media: [],
  send_at: new Date(),
  read_by: []
})

app.listen(3000, () => {
  console.log('success')
})
