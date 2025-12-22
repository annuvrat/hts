// src/controllers/user.controller.ts
import { Context } from 'hono'
import { userService } from '../services/user.service'

export const getUsers = async (c: Context) => {
  const users = await userService.getAllUsers()
  return c.json(users)
}
