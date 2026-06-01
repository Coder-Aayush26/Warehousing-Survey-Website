import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import User from './models/User.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Match server.js env loading: shared root values first, backend overrides second.
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

async function seed() {
  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!adminUsername || !adminPassword) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be configured before seeding the admin user.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ username: adminUsername });
  if (existing) {
    const passwordMatches = await existing.comparePassword(adminPassword);
    if (!passwordMatches) {
      existing.password = adminPassword;
      await existing.save();
      console.log(`Admin user password updated (${adminUsername})`);
    } else {
      console.log(`Admin user already exists (${adminUsername}) - nothing to do.`);
    }
  } else {
    const user = new User({ username: adminUsername, password: adminPassword });
    await user.save();
    console.log(`Admin user created (${adminUsername})`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
