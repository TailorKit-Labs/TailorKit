const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const publicIdLength = 12;

export const createPublicId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(publicIdLength));
  let id = "";

  for (const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }

  return id;
};
