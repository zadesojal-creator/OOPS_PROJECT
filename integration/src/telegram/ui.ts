export const getMainMenu = (isRegistered: boolean = true) => ({
    reply_markup: {
        keyboard: [
            [{ text: "📝 Register a New Patient" }, { text: "👤 Select an Existing Patient" }],
            [{ text: "👨‍👩‍👧 My Family Members" }, { text: "📅 Book an Appointment" }],
            [{ text: "📊 Check Appointment / Token Status" }, { text: "❓ Help / Clinic FAQs" }]
        ],
        resize_keyboard: true
    }
});

export const getRegisterPhoneMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "📱 Share Phone Number", request_contact: true }],
            [{ text: "🔙 Cancel" }]
        ],
        resize_keyboard: true
    }
});

export const getGenderMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "Female" }, { text: "Male" }],
            [{ text: "Other" }],
            [{ text: "🔙 Cancel" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
});

export const getRelationshipMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "Self" }, { text: "Spouse" }],
            [{ text: "Child" }, { text: "Parent" }],
            [{ text: "Sibling" }, { text: "Other" }],
            [{ text: "🔙 Cancel" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
});

export const getRegistrationConfirmMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "✅ Confirm & Save" }],
            [{ text: "❌ Cancel" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
});

export const getPostRegistrationMenu = (patientName: string) => ({
    reply_markup: {
        keyboard: [
            [{ text: `📅 Book Appointment for ${patientName}` }],
            [{ text: "📝 Register Another Patient" }],
            [{ text: "👨‍👩‍👧 My Family Members" }, { text: "🔙 Main Menu" }]
        ],
        resize_keyboard: true
    }
});

export const getCancelMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "🔙 Cancel" }]
        ],
        resize_keyboard: true
    }
});

export const getFaqTopicsMenu = () => ({
    reply_markup: {
        keyboard: [
            [{ text: "Hospital Info" }, { text: "Doctors" }],
            [{ text: "Departments" }, { text: "Timings" }],
            [{ text: "Services" }, { text: "Fees" }],
            [{ text: "Location" }, { text: "Emergency Info" }],
            [{ text: "🔙 Main Menu" }]
        ],
        resize_keyboard: true
    }
});
