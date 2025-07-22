- tsc: typescript complier bien dich ts sang js
- ts-node: chay truc tiep ts (bien dich ngam)

# Khai báo kiểu dữ liệu

```ts
const userName = "Huy"; // khi biến đã rõ ràng thì không cần định nghĩa kiểu làm gì
console.log(userName);

let num1: number = 0;
num1 += 5;
console.log(num1);

// nếu cần nhất quán trong việc trả về kiểu dữ liệu thì nên viết rõ ra, tránh bị nhập nhằng khi mong muốn return number nhưng code lại lỡ return string
const sum = (num1: number, num2: number): number => {
  return num1 + num2;
};

console.log(sum(num1, num1));
```

# Type

```ts
// type có thể dùng để định nghĩa kiểu riêng
// nên sử dụng type để định nghĩa các hàm có tính tái sử dụng cao
// ví dụ như các handler đều có (req, res, next) ta định nghĩa luôn một cái chung đỡ phải viết nhiều lần

import { Request, Response, NextFunction } from "express";

type Controller<
  ReqParams = any,
  ResBody = any,
  ReqBody = any,
  ReqQuery = any
> = (
  req: Request<ReqParams, ResBody, ReqBody, ReqQuery>,
  res: Response<ResBody>,
  next: NextFunction
) => Promise<void> | void;

// định nghĩa dto cho kiểu req
type RegisterRequestBody = {
  name: string;
  email: string;
  password: string;
};

// định nghĩa dto cho kiểu trả về
type RegisterResponseBody = {
  message: string;
  userId: string;
};

const registerController: Controller<
  {},
  RegisterResponseBody,
  RegisterRequestBody
> = async (req, res) => {
  const { name, email, password } = req.body;
  res.status(201).json({
    message: "Register success",
    userId: "123",
  });
};

// thay vì phải viết
export const registerController = async (
  req: Request<ParamsDictionary, any, RegisterReqBody>,
  res: Response
) => {};
```

# Union

```ts
// union cho phép nhận nhiều kiểu khác nhau
// types/common.ts

// dto định nghĩa cấu trúc của một res khi thành công
export type SuccessResponse<T> = {
  success: true;
  message: string;
  data: T;
};

// dto định nghĩa cấu trúc của một res khi có lỗi
export type ErrorResponse = {
  success: false;
  message: string;
  errorCode?: string;
};

// sử dụng union để lựa chọn 1 trong 2
export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

// controllers/user.controller.ts
import { Request, Response } from "express";
import { ApiResponse } from "../types/common";
import { User } from "../types/user"; // Sử dụng dto để trả về những dữ liệu cần thiết của người dùng, tránh lộ những thông tin nhạy cảm

export const getUser = (req: Request, res: Response<ApiResponse<User>>) => {
  const userId = req.params.id;

  // Giả sử có logic để lấy user từ DB
  const user = fakeDbFindUserById(userId);

  if (!user) {
    const errorResponse: ApiResponse<User> = {
      success: false,
      message: "Không tìm thấy người dùng",
      errorCode: "USER_NOT_FOUND",
    };
    return res.status(404).json(errorResponse);
  }

  const successResponse: ApiResponse<User> = {
    success: true,
    message: "Lấy thông tin người dùng thành công",
    data: user,
  };

  return res.json(successResponse);
};
```

# AS

```ts
// dùng as để ép kiểu
// chỉ ép kiểu khi biết rõ chính xác đó là kiểu cần ép
type User1 = {
  name: string;
  age: number;
};

const u = {} as User1; // Không có name, age nhưng vẫn ép được => KHÔNG AN TOÀN

import express, { Request, Response } from "express";
const app = express();

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    role: "admin" | "user";
  };
}

app.get("/profile", (req, res) => {
  const authReq = req as AuthenticatedRequest; // ép kiểu nhưng trước đó chưa hề có req.user thì vẫn lỗi runtime thôi vì đây chỉ là ép kiểu tĩnh
  console.log(authReq.user.id);
  res.json({ id: authReq.user.id, email: authReq.user.email });
});

app.listen(3000, () => {
  console.log("đang chạy tại cổng 3000");
});
```

# Record(K, V)

```ts
type Num = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type Str = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i";
// Template Literal Types
type A = `${Num} : ${Str}`;

// có 9x9 = 81 kiểu có thể định nghĩa ra từ A
const a: A = "1 : d";
console.log(a);
// chưa biết cái này để làm gì:)))

const nums: number[] = [1, 2, 3, 4];
console.log(nums);
const nums2 = nums.map((num) => num * 2);
console.log(nums2);

type User = {
  name: string;
  age: number;
  address: string;
  gender?: "male";
};

const user1: User = {
  name: "Huy",
  age: 20,
  address: "Ninh Binh",
};

const greet = (user: User) => {
  console.log(`Hello ${user.name}`);
};
greet(user1);

console.log(user1);

// Map<Key, Value>
// Set<T>
// Record<K, V>
// Role type định nghĩa các key
type Role = "admin" | "user" | "guest";

// Tạo dữ liệu bằng Record<Role, string>
const roleDescriptions: Record<Role, string> = {
  admin: "Quản trị viên",
  user: "Người dùng",
  guest: "Khách",
};
console.log(roleDescriptions);

type Test = {
  [key: string]: boolean; // key string value là number
};

const role: Test = {
  admin: true,
};

// values kia nó tham chiếu tới cái mảng nào  đó trong bộ nhớ, và không thể thay đổi cái tham chiếu đó đến một mảng khác(gán lại), chứ thay đổi nội dung mảng thì nó vẫn là tham chiếu tới vùng nhớ đấy, chẳng ảnh hưởng gì
const values: number[] = [1, 2];
values.push(3);
console.log(values);
```

# Satisfies

```ts
// satisfies
// toán tử kiểm tra type
// dùng để kiểm tra một đối tượng có thỏa mãn type nào đó không
type Role = "admin" | "user";

type RolePermissionMap = Record<Role, string[]>;

// phải đúng và đủ key của Role
const permissions = {
  admin: ["read", "write", "delete"],
  user: ["read"],
} satisfies RolePermissionMap;

// Nếu thiếu key "user" → TypeScript báo lỗi
// Nếu thêm key "guest" → TypeScript cũng báo lỗi
```

# Function overload

```ts
function parseId(id: number): number;
function parseId(id: string): number;
function parseId(id: string | number): number {
  return typeof id === "string" ? parseInt(id) : id;
}

const a = parseId("123"); // kiểu: number
const b = parseId(456); // kiểu: number
/*
function parseId(id: string | number): number { ... }
  khi gọi parseId("123") không biết rõ đầu vào là gì, IDE cũng không autocomplete tốt bằng overload.
*/
```

# Tuple

# Intersection

```ts
type BaseUser = { id: string; email: string };
type Admin = { role: "admin"; permissions: string[] };

type AdminUser = BaseUser & Admin;

const user: AdminUser = {
  id: "123",
  email: "admin@gmail.com",
  role: "admin",
  permissions: ["read", "write"],
};
console.log(user);
```

# Interface

- Dùng cho object, class nếu cần extends
- Nên dùng type khi cần union, intersection, hoặc template literal types

# Enum

- Không hay dùng vì tăng dung lượng khi biên dịch sang js

# Type Narrowing

- Ép kiểu giúp tránh lỗi tiềm ẩn khi runtime

```ts
const user = req.user as { id: string }; // ép kiểu mù quáng

if (typeof req.user === "object" && req.user !== null && "id" in req.user) {
  console.log(req.user.id); // An toàn, không cần ép kiểu
}

function handleValue(val: string | number) {
  // Dù bạn biết rõ luồng nào gọi hàm này, nhưng TS **không biết**
  console.log(val.toUpperCase()); // ❌ TS báo lỗi vì val có thể là number
}
// Cần ép kiểu
function handleValue(val: string | number) {
  if (typeof val === "string") {
    console.log(val.toUpperCase());
  }
}
```

# Type Hierarchy

```ts
any
├─ unknown
│  └─ tất cả các kiểu khác
├─ never
├─ void
├─ Primitive types
│   ├─ string, number, boolean, bigint, symbol, null, undefined
├─ Object types
│   ├─ plain object
│   ├─ interface
│   ├─ class
│   ├─ function
│   ├─ tuple
├─ Enum
├─ Generics
├─ Union
├─ Intersection
├─ Utility Types
├─ Conditional + Infer
├─ Mapped Types

```

# type predicate, type assertion, satisfies, utility types

# mapped types, infer, template literal, exhaustive check

# Type Guard

# Type predicate (định vị kiểu)

- Xác định kiểu thực sự của biến

```ts
type Admin = { role: "admin"; name: string };
type User = { role: "user"; name: string };

function isAdmin(person: Admin | User): person is Admin {
  return person.role === "admin";
}

const people: (Admin | User)[] = [
  { role: "admin", name: "Huy" },
  { role: "user", name: "Mai" },
];

const admins = people.filter(isAdmin); // TypeScript hiểu rõ kiểu của admins ✅
```

# Exhaustive Check

# Guard clause

- Thoát hàm sớm thay vì lồng nhiều if

```ts
function doSomething(user: User | null) {
  if (!user) return;
  if (!user.isActive) return;
  if (user.role !== "admin") return;

  // xử lý logic khi chắc chắn user hợp lệ
}
```

# Type Assertion

- Ép kiểu thủ công không có tác dụng khi run time
