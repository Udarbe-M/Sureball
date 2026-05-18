import "react-native-gesture-handler";
import React from "react";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import CoachingModeScreen from "./src/screens/CoachingModeScreen";
import LiveAnalysisScreen from "./src/screens/LiveAnalysisScreen";
import SessionHistoryScreen from "./src/screens/SessionHistoryScreen";
import ShootingTrainingScreen from "./src/screens/ShootingTrainingScreen";
import ProfileMenuScreen from "./src/screens/ProfileMenuScreen";
import ChangePasswordScreen from "./src/screens/ChangePasswordScreen";
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

function HeaderAction({ label, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.backgroundSoft,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: "800", letterSpacing: 0.8 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function AuthLoadingScreen() {
  return (
    <View style={commonStyles.screenCentered}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[commonStyles.title, { marginTop: 18 }]}>Loading SureBall</Text>
      <Text style={commonStyles.subtitle}>Checking your saved session and player profile.</Text>
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
        initialRouteName="Login"
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
              name="Dashboard"
              component={DashboardScreen}
              options={({ navigation }) => ({
                title: "SureBall Dashboard",
                headerRight: () => <HeaderAction label="Menu" onPress={() => navigation.navigate("PlayerMenu")} />,
              })}
            />
            <Stack.Screen name="PlayerMenu" component={ProfileMenuScreen} options={{ title: "Player Menu" }} />
            <Stack.Screen name="CoachingModes" component={CoachingModeScreen} options={{ title: "Select Coaching Mode" }} />
            <Stack.Screen name="LiveAnalysis" component={LiveAnalysisScreen} options={{ title: "Coaching Video Analysis" }} />
            <Stack.Screen
              name="ShootingTraining"
              component={ShootingTrainingScreen}
              options={{ title: "Shooting Training" }}
            />
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
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}
