import { Hono } from 'hono'
import { getUsers } from '../controllers/user.controller'

const router = new Hono()
router.get('/', getUsers)

export default router
