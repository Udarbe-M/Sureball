import "react-native-gesture-handler";
import React from "react";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import CoachingModeScreen from "./src/screens/CoachingModeScreen";
import LiveAnalysisScreen from "./src/screens/LiveAnalysisScreen";
import SessionHistoryScreen from "./src/screens/SessionHistoryScreen";
import ShootingTrainingScreen from "./src/screens/ShootingTrainingScreen";
import { colors } from "./src/theme/colors";

const Stack = createNativeStackNavigator();
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.cardElevated,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

export default function App() {
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerStyle: { backgroundColor: colors.cardElevated },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "800" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "SureBall Dashboard" }} />
        <Stack.Screen name="CoachingModes" component={CoachingModeScreen} options={{ title: "Select Coaching Mode" }} />
        <Stack.Screen name="LiveAnalysis" component={LiveAnalysisScreen} options={{ title: "Live Camera Analysis" }} />
        <Stack.Screen name="ShootingTraining" component={ShootingTrainingScreen} options={{ title: "Shooting Training" }} />
        <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} options={{ title: "Session History" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
