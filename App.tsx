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
      <Stack.Navigator initialRouteName="VoiceInterview">
        <Stack.Screen 
          name="VoiceInterview" 
          component={VoiceInterviewScreen} 
          options={{ headerShown: false }} 
          // Pass mock params for testing if needed
          initialParams={{ resumeContext: "Senior React Native Developer" }} 
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
