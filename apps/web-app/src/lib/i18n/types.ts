import { en } from './dictionaries/en';

type EnDictionary = typeof en;
type EnDashboard = EnDictionary['dashboard'];

export type Dictionary = Omit<EnDictionary, 'dashboard'> & {
  dashboard: Omit<EnDashboard, 'status'> & {
    status: Record<string, string>;
  };
};
