"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ChevronLeftIcon, ChevronRightIcon, PanelLeftIcon } from "lucide-react";
import * as React from "react";

import { cn } from "#ui";
import { Button } from "#ui/button";
import { useMediaQuery } from "#ui/hooks/use-media-query";
import { ScrollArea } from "#ui/scroll-area";
import { Separator } from "#ui/separator";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "#ui/sheet";

declare module "react" {
  interface CSSProperties {
    "--sidebar-width"?: string;
  }
}

const isStringValue = <TValue,>(value: TValue): value is TValue & string =>
  typeof value === "string";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";

export interface SidebarContextProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
}

export const SidebarContext = React.createContext<SidebarContextProps | null>(
  null
);

export const useSidebar = (): SidebarContextProps => {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }
  return context;
};

export const SidebarProvider = ({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.ReactElement => {
  const isMobile = useMediaQuery("max-lg");
  const [openMobile, setOpenMobile] = React.useState(false);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = openProp ?? internalOpen;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (onOpenChange) {
        onOpenChange(value);
      } else {
        setInternalOpen(value);
      }
    },
    [onOpenChange]
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((v) => !v);
    } else {
      setOpen(!open);
    }
  }, [isMobile, open, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleSidebar]);

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, setOpen, toggleSidebar]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className
        )}
        data-slot="sidebar-wrapper"
        style={{ "--sidebar-width": SIDEBAR_WIDTH, ...style }}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
        <SheetPopup
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          data-mobile="true"
          data-slot="sidebar"
          side="left"
          style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      data-variant="inset"
    >
      {/* Gap element that pushes the main content */}
      <div
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-300 ease-in-out",
          !open && "w-0"
        )}
        data-slot="sidebar-gap"
      />
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) opacity-100 transition-opacity duration-300 ease-in-out md:flex",
          !open && "opacity-0",
          className
        )}
        data-slot="sidebar-container"
        inert={!open}
        {...props}
      >
        <div
          className="flex h-full w-full flex-col bg-sidebar"
          data-slot="sidebar-inner"
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export const SidebarInset = ({
  className,
  ...props
}: React.ComponentProps<"main">): React.ReactElement => (
  <main
    className={cn(
      "relative z-20 flex w-full flex-1 flex-col bg-background",
      "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2",
      "not-dark:bg-clip-padding lg:rounded-2xl lg:border lg:shadow-xs/5",
      "mt-1 mr-1 mb-1 ml-1 lg:before:pointer-events-none lg:before:absolute lg:before:inset-0 lg:before:rounded-[calc(var(--radius-2xl)-1px)] lg:before:shadow-[0_1px_--theme(--color-black/4%)] dark:lg:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      className
    )}
    data-slot="sidebar-inset"
    {...props}
  />
);

export const SidebarTrigger = ({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>): React.ReactElement => {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      className={cn(className)}
      data-slot="sidebar-trigger"
      size="icon"
      variant="ghost"
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
};

export const SidebarHeader = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("flex flex-col gap-2 p-2", className)}
    data-slot="sidebar-header"
    {...props}
  />
);

export const SidebarHeaderRow = ({
  children,
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("flex h-13 items-center justify-between pl-2", className)}
    data-slot="sidebar-header-row"
    {...props}
  >
    {children}
    <SidebarTrigger />
  </div>
);

export const SidebarFooter = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("flex flex-col gap-2 p-2", className)}
    data-slot="sidebar-footer"
    {...props}
  />
);

export const SidebarContent = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <ScrollArea
    className="**:data-[slot=scroll-area-scrollbar]:hidden"
    scrollFade
  >
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto",
        className
      )}
      data-slot="sidebar-content"
      {...props}
    />
  </ScrollArea>
);

export const SidebarSeparator = ({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.ReactElement => (
  <Separator
    className={cn("mx-2 w-auto bg-sidebar-border", className)}
    data-slot="sidebar-separator"
    {...props}
  />
);

export const SidebarGroup = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
    data-slot="sidebar-group"
    {...props}
  />
);

export const SidebarGroupLabel = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn(
      "flex h-8 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-sidebar-foreground/60",
      className
    )}
    data-slot="sidebar-group-label"
    {...props}
  />
);

export const SidebarMenu = ({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement => (
  <ul
    className={cn("flex w-full min-w-0 flex-col gap-1", className)}
    data-slot="sidebar-menu"
    {...props}
  />
);

export const SidebarMenuItem = ({
  className,
  ...props
}: React.ComponentProps<"li">): React.ReactElement => (
  <li
    className={cn("group/menu-item relative", className)}
    data-slot="sidebar-menu-item"
    {...props}
  />
);

export const SidebarMenuButton = ({
  isActive = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
}): React.ReactElement => {
  const defaultProps = {
    className: cn(
      "flex h-8 w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-left text-sm text-sidebar-accent-foreground/75 ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50",
      "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
      "[&>span:last-child]:truncate [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4",
      className
    ),
    "data-active": isActive,
    "data-slot": "sidebar-menu-button",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps(defaultProps, props),
    render,
  });
};

// --- Nested panel navigation ---

interface SidebarPanelsContextProps {
  activePanel: string;
  setActivePanel: (panel: string) => void;
  panelOrder: string[];
}

const SidebarPanelsContext =
  React.createContext<SidebarPanelsContextProps | null>(null);

const useSidebarPanels = (): SidebarPanelsContextProps => {
  const context = React.useContext(SidebarPanelsContext);
  if (!context) {
    throw new Error("useSidebarPanels must be used within SidebarPanels.");
  }
  return context;
};

const getPanelNames = (children: React.ReactNode): string[] => {
  const names: string[] = [];

  // oxlint-disable-next-line react/no-react-children -- The compound sidebar API accepts React fragments and arbitrary children; traverse them with React’s public API.
  React.Children.forEach(children, (child) => {
    if (
      !React.isValidElement<{ children?: React.ReactNode; name?: unknown }>(
        child
      )
    ) {
      return;
    }

    if (child.type === React.Fragment) {
      names.push(...getPanelNames(child.props.children));
      return;
    }

    if (isStringValue(child.props.name)) {
      names.push(child.props.name);
    }
  });

  return names;
};

export const SidebarPanels = ({
  defaultPanel,
  panel: panelProp,
  onPanelChange,
  children,
}: {
  defaultPanel: string;
  panel?: string;
  onPanelChange?: (panel: string) => void;
  children: React.ReactNode;
}): React.ReactElement => {
  const [internalPanel, setInternalPanel] = React.useState(defaultPanel);
  const panelOrder = React.useMemo(() => getPanelNames(children), [children]);
  const activePanel = panelProp ?? internalPanel;

  const setActivePanel = React.useCallback(
    (panel: string) => {
      if (onPanelChange) {
        onPanelChange(panel);
      } else {
        setInternalPanel(panel);
      }
    },
    [onPanelChange]
  );

  const contextValue = React.useMemo(
    () => ({ activePanel, panelOrder, setActivePanel }),
    [activePanel, panelOrder, setActivePanel]
  );

  return (
    <SidebarPanelsContext.Provider value={contextValue}>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </SidebarPanelsContext.Provider>
  );
};

export const SidebarPanel = ({
  name,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { name: string }): React.ReactElement => {
  const { activePanel, panelOrder } = useSidebarPanels();

  const activeIndex = panelOrder.indexOf(activePanel);
  const myIndex = panelOrder.indexOf(name);
  const isActive = activePanel === name;

  let translate = "translate-x-0";
  if (!isActive) {
    translate =
      myIndex < activeIndex ? "-translate-x-full" : "translate-x-full";
  }

  return (
    <div
      aria-hidden={!isActive}
      className={cn(
        "absolute inset-0 flex flex-col transition-transform duration-200 ease-in-out",
        translate,
        className
      )}
      data-panel={name}
      data-slot="sidebar-panel"
      inert={!isActive}
      {...props}
    >
      {children}
    </div>
  );
};

export const SidebarPanelTrigger = ({
  target,
  children,
  back = false,
  isActive = false,
  ...props
}: {
  target: string;
  back?: boolean;
  isActive?: boolean;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement => {
  const { setActivePanel } = useSidebarPanels();
  return (
    <Button
      className={cn(
        "w-full text-sidebar-accent-foreground/75 hover:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
        back ? "mb-1 px-2.5 text-center" : "text-left"
      )}
      data-active={isActive}
      onClick={() => {
        setActivePanel(target);
      }}
      variant="ghost"
      size={back ? "lg" : "default"}
      {...props}
    >
      {back && <ChevronLeftIcon />}
      {children}
      {!back && <ChevronRightIcon />}
      {back && <span className="size-4" aria-hidden="true" />}
    </Button>
  );
};
