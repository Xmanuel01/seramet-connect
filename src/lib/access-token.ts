let accessToken: string | undefined;

export function setSerametAccessToken(token: string | undefined) {
  accessToken = token;
}

export function getSerametAccessToken() {
  return accessToken;
}
