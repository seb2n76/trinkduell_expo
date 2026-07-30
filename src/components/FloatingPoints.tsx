import React, { useEffect } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
} from "react-native-reanimated";

export interface FloatingPointItemType {
  id: string;
  x: number;
  y: number;
  text: string;
}

interface FloatingPointProps {
  id: string;
  x: number;
  y: number;
  text: string;
  onComplete: (id: string) => void;
}

export function FloatingPointItem({ id, x, y, text, onComplete }: FloatingPointProps) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    // Fade in and scale up fast
    opacity.value = withTiming(1, { duration: 150 });
    scale.value = withTiming(1.2, { duration: 150 });

    // Float upwards
    translateY.value = withTiming(-120, { duration: 900 }, (finished) => {
      if (finished) {
        runOnJS(onComplete)(id);
      }
    });

    // Sequence for fading and scaling down at the end
    opacity.value = withSequence(
      withTiming(1, { duration: 550 }),
      withTiming(0, { duration: 350 })
    );

    scale.value = withSequence(
      withTiming(1.2, { duration: 550 }),
      withTiming(0.7, { duration: 350 })
    );
  }, [id, onComplete, opacity, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      position: "absolute",
      left: x - 45, // center the 90px wide bubble
      top: y - 25,
      opacity: opacity.value,
      transform: [
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <Animated.View style={[styles.container, animatedStyle]} pointerEvents="none">
      <Text style={styles.text}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderColor: "#22d3ee", // cyan border
    borderWidth: 1.5,
    borderRadius: 20,
    width: 90,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#22d3ee",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  text: {
    color: "#22d3ee",
    fontSize: 13,
    fontWeight: "900",
    textShadowColor: "rgba(34, 211, 238, 0.6)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
});
