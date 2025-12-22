import { User } from "../types/user";

const users: User[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

class UserService {
    getAllUsers(): User[] {
        return users;
    }}

export const userService = new UserService();