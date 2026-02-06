import 'react-native-gesture-handler'; // MUST BE AT THE TOP
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';

// Import your screens
import VoiceInterviewScreen from './src/screens/VoiceInterviewScreen';
import { TestAudioStreamPage } from './src/screens/TestAudioStreamPage';

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
        <Stack.Screen
          name="TestAudioStream"
          component={TestAudioStreamPage}
          options={{
            title: 'Audio Stream Test',
            headerStyle: { backgroundColor: '#111827' },
            headerTintColor: '#F9FAFB',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
