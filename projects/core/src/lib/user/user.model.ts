import type { Timestamp } from 'firebase/firestore';

export interface AppUser {
  id: string;
  avatarUrl: string | null;
  createdAt: Timestamp;
  email: string;
  name: string;
  role: UserRole;
}

export enum UserRole {
  ADMIN = 'admin',
  MEMBER = 'member',
  FREE = 'free',
}
