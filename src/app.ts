import express from 'express'
import databaseService from './config/mongo.service'
import { getEnvConfig } from './config/getEnvConfig'
import { ObjectId } from 'mongodb'
getEnvConfig()
const app = express()
databaseService.users.insertOne({
  _id: new ObjectId(),
  name: 'Test User',
  email: 'test@example.com',
  date_of_birth: new Date(),
  password: '',
  created_at: new Date(),
  updated_at: new Date(),
  email_verify_token: '',
  forgot_password_token: '',
  verify: undefined,
  twitter_circle: [],
  bio: '',
  location: '',
  website: '',
  username: '',
  avatar: '',
  cover_photo: ''
})

app.listen(3000, () => {
  console.log('success')
})
