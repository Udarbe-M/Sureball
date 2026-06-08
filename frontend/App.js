import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import LiveAnalysisScreen from "./src/screens/LiveAnalysisScreen";
import SessionHistoryScreen from "./src/screens/SessionHistoryScreen";
import ShootingTrainingScreen from "./src/screens/ShootingTrainingScreen";
import UnifiedCoachingSessionScreen from "./src/screens/UnifiedCoachingSessionScreen";
import FullGuideScreen from "./src/screens/FullGuideScreen";
import ProfileMenuScreen from "./src/screens/ProfileMenuScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ChangePasswordScreen from "./src/screens/ChangePasswordScreen";
import BrandMark from "./src/components/BrandMark";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { colors } from "./src/theme/colors";
import { commonStyles } from "./src/theme/styles";

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

function HeaderAction({ onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: 42,
        height: 42,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 21,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.backgroundSoft,
      }}
    >
      <Feather name="settings" size={18} color={colors.text} />
    </TouchableOpacity>
  );
}

function AuthLoadingScreen() {
  return (
    <View style={[commonStyles.screenCentered, { alignItems: "center" }]}>
      <BrandMark size={76} />
      <Text style={[commonStyles.title, { marginTop: 18 }]}>Loading SureBall</Text>
      <Text style={[commonStyles.subtitle, { textAlign: "center", maxWidth: 280 }]}>
        Checking your saved session and player profile.
      </Text>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={isAuthenticated ? "CoachingModes" : "Login"}
        screenOptions={{
          headerStyle: { backgroundColor: colors.cardElevated },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "800" },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {isAuthenticated ? (
          <>
            <Stack.Screen
              name="CoachingModes"
              component={UnifiedCoachingSessionScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Dashboard"
              component={DashboardScreen}
              options={({ navigation }) => ({
                title: "SureBall Dashboard",
                headerRight: () => <HeaderAction onPress={() => navigation.navigate("Settings")} />,
              })}
            />
            <Stack.Screen name="PlayerMenu" component={ProfileMenuScreen} options={{ title: "Profile" }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
            <Stack.Screen
              name="UnifiedCoachingSession"
              component={UnifiedCoachingSessionScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="LiveAnalysis" component={LiveAnalysisScreen} options={{ title: "Coaching Video Analysis" }} />
            <Stack.Screen
              name="ShootingTraining"
              component={ShootingTrainingScreen}
              options={{ title: "Shooting Training" }}
            />
            <Stack.Screen name="FullGuide" component={FullGuideScreen} options={{ title: "Full Guide" }} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: "Change Password" }} />
            <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} options={{ title: "Session History" }} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
