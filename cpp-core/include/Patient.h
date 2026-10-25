#pragma once
#include "Person.h"
#include <string>

namespace ClinicQueue {

/*
 * Patient — IS-A Person (OOP: Inheritance).
 *
 * A patient adds:
 *   - telegramChatId : links the patient's Firestore record to a Telegram session
 *   - notes          : private clinical notes (not shown to RECEPTIONIST role)
 *
 * Because Patient inherits from Person, it automatically has id, name,
 * phone, age, and gender without duplicating those fields.
 */
class Patient : public Person {
public:
    Patient(std::string id,
            std::string name,
            std::string phone,
            int age,
            std::string gender,
            std::string notes = "",
            std::string telegramChatId = "")
        : Person(std::move(id), std::move(name), std::move(phone), age, std::move(gender))
        , notes_(std::move(notes))
        , telegramChatId_(std::move(telegramChatId))
    {}

    // Override the pure virtual — Patient's role is always Patient.
    Role role() const override { return Role::Patient; }

    const std::string& notes()          const { return notes_; }
    const std::string& telegramChatId() const { return telegramChatId_; }

    void setNotes(std::string n)          { notes_          = std::move(n); }
    void setTelegramChatId(std::string t) { telegramChatId_ = std::move(t); }

    // Senior check — used by queue priority logic.
    bool isSenior() const { return age() >= 60; }

private:
    std::string notes_;
    std::string telegramChatId_;
};

} // namespace ClinicQueue
