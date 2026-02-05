import 'react-native-gesture-handler'; // MUST BE AT THE TOP
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Import your screen
import VoiceInterviewScreen from './src/screens/VoiceInterviewScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Interview">
        <Stack.Screen
          name="Interview"
          component={VoiceInterviewScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
