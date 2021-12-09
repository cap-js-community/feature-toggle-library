"use strict";

jest.spyOn(console, "log").mockImplementation(); // turn off regular logging;
jest.spyOn(console, "error").mockImplementation(); // turn off error logging;
