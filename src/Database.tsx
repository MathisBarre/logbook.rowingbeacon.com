import { useState } from "react";
import { getDatabase } from "./_common/database/database";

export async function createUser(name: string) {
  const db = await getDatabase();
  await db.execute(
    /*sql*/ `
      INSERT INTO users (name) VALUES ($1)
    `,
    [name]
  );
}

export async function getUsers() {
  const db = await getDatabase();
  return db.select<
    {
      id: number;
      name: string;
    }[]
  >(/*sql*/ `
    SELECT * FROM users
  `);
}

export const Database = () => {
  const [name, setName] = useState("");
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);

  const refreshUsers = async () => {
    const users = await getUsers();
    setUsers(users);
  };

  return (
    <main className="container">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();

          try {
            await createUser(name);
            setName("");
            await refreshUsers();
          } catch (e) {
            console.error(e);
          }
        }}
      >
        <input
          id="greet-input"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit">Register user</button>
      </form>
      <button
        type="button"
        onClick={() => {
          try {
            refreshUsers();
          } catch (e) {
            console.error(e);
          }
        }}
      >
        Refresh users
      </button>

      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </main>
  );
};
