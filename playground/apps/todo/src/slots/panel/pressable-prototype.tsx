import { useState } from "preact/hooks";

import { Box, Flex, Inline, Pressable } from "#patchsmith";

export const PressablePrototype = () => {
  const [presses, setPresses] = useState(0);
  const [disabled, setDisabled] = useState(false);

  const countPress = () => {
    setPresses((count) => count + 1);
  };

  const background = {
    ":active": { default: "pressed", lg: "hover" },
    ":hover": "hover",
    default: "surface",
  } as const;

  const borderColor = {
    ":focus-visible": "focus",
    default: "default",
  } as const;

  const textColor = { ":disabled": "muted" } as const;

  return (
    <Flex direction="column" gap="2">
      <Box>Pressable layouts</Box>
      <Box textColor="muted">
        Use Tab / Shift+Tab to focus. Enter activates on press; Space activates
        on release. Disabled examples leave the tab order. Pressed {presses}{" "}
        times.
      </Box>
      <Flex align="center" gap="2" wrap="wrap">
        <Pressable
          background={background}
          border="solid"
          borderColor={borderColor}
          disabled={disabled}
          onPress={countPress}
          padding="2"
          radius="lg"
          textColor={textColor}
        >
          Inline action
        </Pressable>
        <Pressable
          onPress={() => {
            setDisabled((value) => !value);
          }}
          padding="2"
          radius="lg"
          background={{ ":hover": "hover" }}
        >
          {disabled ? "Enable examples" : "Disable examples"}
        </Pressable>
        <Pressable
          ariaLabel="Open next email"
          background={background}
          disabled={disabled}
          onPress={countPress}
          padding="2"
          radius="lg"
          textColor={textColor}
        >
          →
        </Pressable>
      </Flex>
      <Pressable
        background={background}
        border="solid"
        borderColor={borderColor}
        disabled={disabled}
        layout="box"
        onPress={countPress}
        padding={{ default: "2", lg: "4" }}
        radius="lg"
        textColor={textColor}
        width="full"
      >
        A full-width box action
      </Pressable>
      <Pressable
        ariaLabel="Open email from Alex Chen: Project update"
        align="center"
        background={background}
        border="solid"
        borderColor={borderColor}
        disabled={disabled}
        gap="2"
        justify="between"
        layout="flex"
        onPress={countPress}
        padding="4"
        radius="lg"
        textColor={textColor}
        width="full"
      >
        <Box grow="1">
          <Inline>Alex Chen: </Inline>
          <Inline>Project update</Inline>
        </Box>
        <Inline textColor="muted">10:42</Inline>
      </Pressable>
      <Pressable
        background={background}
        border="solid"
        borderColor={borderColor}
        columns={2}
        disabled={disabled}
        gap="2"
        layout="grid"
        onPress={countPress}
        padding="4"
        radius="lg"
        textColor={textColor}
        width="full"
      >
        <Inline>Grid action</Inline>
        <Inline textColor="muted">Two columns</Inline>
      </Pressable>
      <Box textColor="muted">
        Nest Box, Flex, Grid, or Inline for layout. Keep buttons, links, inputs,
        and other interactive controls outside Pressable.
      </Box>
    </Flex>
  );
};
