import "react-native-gesture-handler";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import CoachingModeScreen from "./src/screens/CoachingModeScreen";
import LiveAnalysisScreen from "./src/screens/LiveAnalysisScreen";
import SessionHistoryScreen from "./src/screens/SessionHistoryScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "SureBall Dashboard" }} />
        <Stack.Screen name="CoachingModes" component={CoachingModeScreen} options={{ title: "Select Coaching Mode" }} />
        <Stack.Screen name="LiveAnalysis" component={LiveAnalysisScreen} options={{ title: "Live Camera Analysis" }} />
        <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} options={{ title: "Session History" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
