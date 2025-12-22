import { Hono } from "hono";

const app = new Hono();
import userRouter from './routes/user.routes';
// Mount user routes
app.route('/users', userRouter);
app.get('/check',(c)=>{
    return c.json({ message: 'Hello, check!' });
})
app.get('/',(c)=>{
    return c.json({ message: 'Hello, hono!' });
})



export default app;

 