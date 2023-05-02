export const getEnv = <T extends string>(key: string): T => {
  const value = process.env[key] as any;

  if (!value) {
    throw new Error(`Cannot get ${key} from \`process.env\``);
  }

  return value as T;
};
