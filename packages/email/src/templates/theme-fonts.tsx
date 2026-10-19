import { Font } from "react-email";

export const PatchSmithFonts = () => (
  <>
    <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@700&display=swap');
      `}</style>
    <Font
      fallbackFontFamily={["Arial", "sans-serif"]}
      fontFamily="Geist"
      fontStyle="normal"
      fontWeight={400}
    />
    <Font
      fallbackFontFamily={["Arial", "sans-serif"]}
      fontFamily="Geist"
      fontStyle="normal"
      fontWeight={500}
    />
    <Font
      fallbackFontFamily={["Arial", "sans-serif"]}
      fontFamily="Geist"
      fontStyle="normal"
      fontWeight={600}
    />
    <Font
      fallbackFontFamily={["Arial", "sans-serif"]}
      fontFamily="Geist"
      fontStyle="normal"
      fontWeight={700}
    />
    <Font
      fallbackFontFamily={["Arial", "monospace"]}
      fontFamily="Geist Mono"
      fontStyle="normal"
      fontWeight={700}
    />
  </>
);
