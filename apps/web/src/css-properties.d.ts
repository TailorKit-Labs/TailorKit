import "react";

declare module "react" {
  interface CSSProperties {
    "--column-width"?: string;
  }
}
