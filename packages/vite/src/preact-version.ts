export const MINIMUM_PREACT_MAJOR_VERSION = 11;

export interface PreactVersionCheck {
  major: number;
  version: string;
}

export const parsePreactVersion = (version: string): PreactVersionCheck => {
  const match = /^(?<major>\d+)\./u.exec(version);

  if (!(match?.[1] !== undefined && match?.[1] !== null && match?.[1] !== "")) {
    throw new Error(`Unable to parse Preact version "${version}".`);
  }

  return {
    major: Math.trunc(Number(match[1])),
    version,
  };
};

export const assertSupportedPreactVersion = (
  version: string
): PreactVersionCheck => {
  const check = parsePreactVersion(version);

  if (check.major < MINIMUM_PREACT_MAJOR_VERSION) {
    throw new Error(
      `Patchsmith requires Preact ${MINIMUM_PREACT_MAJOR_VERSION}.0.0 or newer, but found ${version}.`
    );
  }

  return check;
};
