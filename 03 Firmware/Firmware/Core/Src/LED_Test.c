#include "LED_Test.h"
#include "gpio.h" // Assuming GPIO_PIN_x and HAL_GPIO_WritePin are defined here

// Define LED pins based on PIN_CONFIGURATION.md
// Anode pins (CxRy_Pin) are on GPIOA
#define C0R0_GPIO_Port GPIOA
#define C0R0_Pin GPIO_PIN_0
#define C0R1_GPIO_Port GPIOA
#define C0R1_Pin GPIO_PIN_1
#define C0R2_GPIO_Port GPIOA
#define C0R2_Pin GPIO_PIN_2
#define C1R0_GPIO_Port GPIOA
#define C1R0_Pin GPIO_PIN_3
#define C1R1_GPIO_Port GPIOA
#define C1R1_Pin GPIO_PIN_4
#define C1R2_GPIO_Port GPIOA
#define C1R2_Pin GPIO_PIN_5
#define C2R0_GPIO_Port GPIOA
#define C2R0_Pin GPIO_PIN_6
#define C2R1_GPIO_Port GPIOA
#define C2R1_Pin GPIO_PIN_7
#define C2R2_GPIO_Port GPIOA
#define C2R2_Pin GPIO_PIN_8

// Cathode control pins (R_Ctrl_Pin, G_Ctrl_Pin, B_Ctrl_Pin) are on GPIOB
#define B_Ctrl_GPIO_Port GPIOB
#define B_Ctrl_Pin GPIO_PIN_10
#define R_Ctrl_GPIO_Port GPIOB
#define R_Ctrl_Pin GPIO_PIN_8
#define G_Ctrl_GPIO_Port GPIOB
#define G_Ctrl_Pin GPIO_PIN_9

// Array of anode pins for easier iteration
GPIO_TypeDef* Anode_Ports[] = {C0R0_GPIO_Port, C0R1_GPIO_Port, C0R2_GPIO_Port,
                               C1R0_GPIO_Port, C1R1_GPIO_Port, C1R2_GPIO_Port,
                               C2R0_GPIO_Port, C2R1_GPIO_Port, C2R2_GPIO_Port,
                               CtrlLed_GPIO_Port};
uint16_t Anode_Pins[] = {C0R0_Pin, C0R1_Pin, C0R2_Pin,
                         C1R0_Pin, C1R1_Pin, C1R2_Pin,
                         C2R0_Pin, C2R1_Pin, C2R2_Pin,
                         CtrlLed_Pin};
#define NUM_ANODE_PINS (sizeof(Anode_Pins) / sizeof(Anode_Pins[0]))

// Function to turn all LEDs of a specific color ON or OFF
void Set_All_Color_LEDs(GPIO_TypeDef* R_Port, uint16_t R_Pin,
                        GPIO_TypeDef* G_Port, uint16_t G_Pin,
                        GPIO_TypeDef* B_Port, uint16_t B_Pin,
                        GPIO_PinState R_state, GPIO_PinState G_state, GPIO_PinState B_state)
{  
    // Set all anode pins high to enable all LEDs
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    // Set the cathode control pins to the desired states
    // Set all anode pins high to enable all LEDs
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    // Set the cathode control pins to the desired states
    HAL_GPIO_WritePin(R_Port, R_Pin, R_state);
    HAL_GPIO_WritePin(G_Port, G_Pin, G_state);
    HAL_GPIO_WritePin(B_Port, B_Pin, B_state);
}

// Function to turn a specific LED ON or OFF
void Set_Individual_LED(GPIO_TypeDef* Anode_Port, uint16_t Anode_Pin,
                        GPIO_TypeDef* Ctrl_Port, uint16_t Ctrl_Pin, GPIO_PinState state)
{
    // Turn off all other LEDs first
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    HAL_GPIO_WritePin(R_Ctrl_GPIO_Port, R_Ctrl_Pin, GPIO_PIN_SET);
    HAL_GPIO_WritePin(G_Ctrl_GPIO_Port, G_Ctrl_Pin, GPIO_PIN_SET);
    HAL_GPIO_WritePin(B_Ctrl_GPIO_Port, B_Ctrl_Pin, GPIO_PIN_SET);

    // Set the specific anode pin
    HAL_GPIO_WritePin(Anode_Port, Anode_Pin, state);
    // Set the specific cathode control pin
    HAL_GPIO_WritePin(Ctrl_Port, Ctrl_Pin, (state == GPIO_PIN_SET) ? GPIO_PIN_RESET : GPIO_PIN_SET);
}


void LED_Test_All(void)
{
    // Turn all Red LEDs on
    Set_All_Color_LEDs(R_Ctrl_GPIO_Port, R_Ctrl_Pin, G_Ctrl_GPIO_Port, G_Ctrl_Pin, B_Ctrl_GPIO_Port, B_Ctrl_Pin,
                       GPIO_PIN_SET, GPIO_PIN_RESET, GPIO_PIN_RESET);
    HAL_Delay(1000); // Display Red for 1 second

    // Turn all Green LEDs on
    Set_All_Color_LEDs(R_Ctrl_GPIO_Port, R_Ctrl_Pin, G_Ctrl_GPIO_Port, G_Ctrl_Pin, B_Ctrl_GPIO_Port, B_Ctrl_Pin,
                       GPIO_PIN_RESET, GPIO_PIN_SET, GPIO_PIN_RESET);
    HAL_Delay(1000); // Display Green for 1 second

    // Turn all Blue LEDs on
    Set_All_Color_LEDs(R_Ctrl_GPIO_Port, R_Ctrl_Pin, G_Ctrl_GPIO_Port, G_Ctrl_Pin, B_Ctrl_GPIO_Port, B_Ctrl_Pin,
                       GPIO_PIN_RESET, GPIO_PIN_RESET, GPIO_PIN_SET);
    HAL_Delay(1000); // Display Blue for 1 second

    // Turn all LEDs off
    Set_All_Color_LEDs(R_Ctrl_GPIO_Port, R_Ctrl_Pin, G_Ctrl_GPIO_Port, G_Ctrl_Pin, B_Ctrl_GPIO_Port, B_Ctrl_Pin,
                       GPIO_PIN_RESET, GPIO_PIN_RESET, GPIO_PIN_RESET);
    HAL_Delay(1000); // Display nothing for 1 second
}

void LED_Test_Individual(void)
{
    // Cycle through each anode pin with Red color
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        Set_Individual_LED(Anode_Ports[i], Anode_Pins[i], R_Ctrl_GPIO_Port, R_Ctrl_Pin, GPIO_PIN_SET);
        HAL_Delay(100);
    }
    // Turn off all LEDs
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    HAL_GPIO_WritePin(R_Ctrl_GPIO_Port, R_Ctrl_Pin, GPIO_PIN_SET);
    HAL_Delay(200);

    // Cycle through each anode pin with Green color
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        Set_Individual_LED(Anode_Ports[i], Anode_Pins[i], G_Ctrl_GPIO_Port, G_Ctrl_Pin, GPIO_PIN_SET);
        HAL_Delay(100);
    }
    // Turn off all LEDs
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    HAL_GPIO_WritePin(G_Ctrl_GPIO_Port, G_Ctrl_Pin, GPIO_PIN_SET);
    HAL_Delay(200);

    // Cycle through each anode pin with Blue color
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        Set_Individual_LED(Anode_Ports[i], Anode_Pins[i], B_Ctrl_GPIO_Port, B_Ctrl_Pin, GPIO_PIN_SET);
        HAL_Delay(100);
    }
    // Turn off all LEDs
    for (int i = 0; i < NUM_ANODE_PINS; i++)
    {
        HAL_GPIO_WritePin(Anode_Ports[i], Anode_Pins[i], GPIO_PIN_RESET);
    }
    HAL_GPIO_WritePin(B_Ctrl_GPIO_Port, B_Ctrl_Pin, GPIO_PIN_SET);
    HAL_Delay(200);
}