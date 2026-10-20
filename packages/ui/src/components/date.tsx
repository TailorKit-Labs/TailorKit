"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import {
  Tooltip,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

dayjs.extend(relativeTime);

interface DateAgoProps {
  date: Date | string | number;
  className?: string;
}

export const DateAgo = ({ date, className }: DateAgoProps) => {
  const d = dayjs(date);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className={className}>
          <time dateTime={d.toISOString()}>{d.fromNow()}</time>
        </TooltipTrigger>
        <TooltipPopup>{d.format("D MMM YYYY, HH:mm")}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
};
