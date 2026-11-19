import { forwardRef, type ComponentRef } from 'react';
import { Button as PaperButton, type ButtonProps as PaperButtonProps } from 'react-native-paper';

export const AppButton = forwardRef<ComponentRef<typeof PaperButton>, PaperButtonProps>(
  function AppButton({ style, ...props }, ref) {
    return <PaperButton {...props} ref={ref} style={[{ minHeight: 48 }, style]} />;
  },
);
